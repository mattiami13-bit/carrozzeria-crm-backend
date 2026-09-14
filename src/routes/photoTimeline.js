import {Router} from 'express';
import {z} from 'zod';
import {prisma} from '../lib/prisma.js';
import {requireAuth} from '../middleware/auth.js';
import {PHOTO_CATEGORIES,photoMeta,sortedPhotos,phaseForCategory,timelineEditSchema,dossierPhotos} from '../lib/photo-timeline.js';
import {savePhotoSuggestion,readPhotoImage,normalizePhoto} from '../lib/photo-timeline-service.js';
import {buildPhotoDossier} from '../lib/photo-dossier.js';
export const photoTimelineRouter=Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
photoTimelineRouter.use(requireAuth);
photoTimelineRouter.use(wrap(async(req,res,next)=>{const u=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId:req.auth.tenantId,attivo:true},select:{ruolo:true}});if(!u)return res.status(403).json({error:'Account non attivo'});req.photoRole=u.ruolo;next();}));
const scope=req=>({tenantId:req.auth.tenantId,...(req.photoRole==='TECNICO'?{tecnicoId:req.auth.userId}:{})});
photoTimelineRouter.get('/vehicles/:id',wrap(async(req,res)=>{
 const vehicle=await prisma.vehicle.findFirst({where:{id:req.params.id,...scope(req)},include:{photos:true}});if(!vehicle)return res.status(404).json({error:'Pratica non disponibile'});
 res.json({photos:sortedPhotos(vehicle.photos),categories:PHOTO_CATEGORIES,canExport:true});
}));
photoTimelineRouter.patch('/photos/:id',wrap(async(req,res)=>{
 const parsed=z.object({version:z.number().int().positive(),data:timelineEditSchema}).strict().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});
 const p=await prisma.photo.findFirst({where:{id:req.params.id,vehicle:scope(req)}});if(!p)return res.status(404).json({error:'Foto non disponibile'});
 if(p.timelineVersion!==parsed.data.version)return res.status(409).json({error:"Foto aggiornata. Ricarica prima di salvare."});
 const result=await prisma.$transaction(async tx=>{
  const data={...photoMeta(p),...parsed.data.data};const changed=await tx.photo.updateMany({where:{id:p.id,timelineVersion:parsed.data.version},data:{timeline:data,fase:phaseForCategory(data.category,p.fase),timelineVersion:{increment:1}}});if(!changed.count)return null;
  await tx.photoTimelineEdit.create({data:{photoId:p.id,actorId:req.auth.userId,before:photoMeta(p),after:data}});return tx.photo.findUnique({where:{id:p.id}});
 });if(!result)return res.status(409).json({error:'Foto aggiornata da un altro operatore. Ricarica prima di salvare.'});res.json(result);
}));
photoTimelineRouter.post('/photos/:id/suggest',wrap(async(req,res)=>{
 const p=await prisma.photo.findFirst({where:{id:req.params.id,vehicle:scope(req)}});if(!p)return res.status(404).json({error:'Foto non disponibile'});
 if(photoMeta(p).ai?.status==='ready')return res.json(p);
 const result=await savePhotoSuggestion(p,req.auth.tenantId);res.json(result);
}));
photoTimelineRouter.post('/vehicles/:id/dossier',wrap(async(req,res)=>{
 const parsed=z.object({audience:z.enum(['CLIENTE','ASSICURAZIONE','INTERNO']),photoIds:z.array(z.string()).min(1).max(80).optional(),comparison:z.object({before:z.string(),after:z.string()}).strict().optional()}).strict().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Seleziona da 1 a 80 foto e un destinatario valido'});
 const tenantId=req.auth.tenantId,vehicle=await prisma.vehicle.findFirst({where:{id:req.params.id,...scope(req)},include:{client:true,photos:true,sinistri:{where:{tenantId}},quotes:{where:{tenantId,stato:'ACCETTATO'},include:{items:true}}}});if(!vehicle)return res.status(404).json({error:'Pratica non disponibile'});
 let photos;try{photos=dossierPhotos(vehicle.photos,parsed.data.photoIds);}catch{return res.status(400).json({error:'Foto non appartenenti alla pratica o selezione duplicata'});}
 if(!photos.length||photos.length>80)return res.status(400).json({error:'Seleziona da 1 a 80 fotografie per questo dossier'});
 const cmp=parsed.data.comparison;if(cmp&&(cmp.before===cmp.after||![cmp.before,cmp.after].every(id=>photos.some(p=>p.id===id))))return res.status(400).json({error:'Il confronto deve contenere due fotografie diverse presenti nel dossier'});
 const [tenant,parts]=await Promise.all([prisma.tenant.findUnique({where:{id:tenantId}}),prisma.trackedPart.findMany({where:{tenantId,vehicleId:vehicle.id},orderBy:{createdAt:'asc'}})]);
 const pdf=await buildPhotoDossier({tenant,vehicle,photos,parts,quotes:vehicle.quotes,audience:parsed.data.audience,comparison:cmp,loadImage:async p=>normalizePhoto(await readPhotoImage(p,tenantId))});
 res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="dossier-${vehicle.targa.replace(/[^a-z0-9-]/gi,'_')}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).send(pdf);
}));
