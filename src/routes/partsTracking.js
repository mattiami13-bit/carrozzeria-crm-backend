import {Router} from "express";
import multer from "multer";
import {z} from "zod";
import {prisma} from "../lib/prisma.js";
import {requireAuth} from "../middleware/auth.js";
import {PART_STATES,projectPart,blockedDuration,isBlocking,validDocument} from "../lib/parts-tracking.js";
import {saveTrackedPart,refreshLinkedParts,problem} from "../lib/parts-tracking-service.js";
export const partsTrackingRouter=Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
partsTrackingRouter.use(requireAuth);
partsTrackingRouter.use(wrap(async(req,res,next)=>{
 const user=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId:req.auth.tenantId,attivo:true},select:{ruolo:true}});
 if(!user)return res.status(403).json({error:"Account non attivo"});req.partsRole=user.ruolo;req.partsFinancial=["ADMIN","AMMINISTRAZIONE"].includes(user.ruolo);next();
}));
const writer=(req,res,next)=>req.partsRole!=="TECNICO"?next():res.status(403).json({error:"Solo responsabili e accettazione possono modificare i ricambi"});
const financial=(req,res,next)=>req.partsFinancial?next():res.status(403).json({error:"Documenti e prezzi riservati all’amministrazione"});
const scope=req=>({tenantId:req.auth.tenantId,...(req.partsRole==="TECNICO"?{tecnicoId:req.auth.userId}:{})});
const allowedVehicle=(req,id)=>prisma.vehicle.findFirst({where:{id,...scope(req)},select:{id:true}});
const allowedPart=req=>prisma.trackedPart.findFirst({where:{id:req.params.partId,tenantId:req.auth.tenantId,vehicle:scope(req)}});
const details={events:{orderBy:{createdAt:"desc"},take:30},documents:{select:{id:true,name:true,size:true,createdAt:true}}};
partsTrackingRouter.get("/dashboard",wrap(async(req,res)=>{
 const tenantId=req.auth.tenantId;await refreshLinkedParts(tenantId);
 const vehicles=await prisma.vehicle.findMany({where:scope(req),include:{trackedParts:{where:{tenantId},include:details},partBlocks:{where:{tenantId},orderBy:{startedAt:"asc"}},stageHistory:{orderBy:{changedAt:"desc"},take:1,select:{changedAt:true,toStage:true}}}});
 const rows=vehicles.filter(v=>v.trackedParts.length||v.stage==="ORDINE_RICAMBI").map(v=>{
  const duration=blockedDuration(v.partBlocks),parts=v.trackedParts.map(p=>projectPart(p,req.partsFinancial));
  const waitingWorkflow=v.stage==="ORDINE_RICAMBI"&&!duration.active;
  return {vehicleId:v.id,label:`${v.marca} ${v.modello} · ${v.targa}`,stage:v.stage,duration,parts,waitingWorkflow,
   workflowWaitingSince:waitingWorkflow&&v.stageHistory[0]?.toStage==="ORDINE_RICAMBI"?v.stageHistory[0].changedAt:null,
   blocked:v.stage!=="CONSEGNATA"&&v.trackedParts.some(isBlocking),alerts:v.stage==="CONSEGNATA"?[]:parts.flatMap(p=>p.alerts.map(a=>({...a,partId:p.id,description:p.data.description})))};
 });
 res.json({rows,blockedCount:rows.filter(v=>v.blocked).length,alertCount:rows.reduce((a,v)=>a+v.alerts.length,0)});
}));
partsTrackingRouter.get("/vehicles/:id",wrap(async(req,res)=>{
 if(!await allowedVehicle(req,req.params.id))throw problem(404,"Pratica non disponibile");
 const tenantId=req.auth.tenantId,vehicleId=req.params.id;await refreshLinkedParts(tenantId,vehicleId);
 const [parts,intervals,ledger,orders,catalog]=await Promise.all([
  prisma.trackedPart.findMany({where:{tenantId,vehicleId},include:details,orderBy:{createdAt:"asc"}}),
  prisma.vehiclePartBlock.findMany({where:{tenantId,vehicleId},orderBy:{startedAt:"asc"}}),
  req.partsFinancial?prisma.profitRecord.findFirst({where:{tenantId,vehicleId}}):null,
  req.partsRole!=="TECNICO"?prisma.supplierOrderItem.findMany({where:{supplierOrder:{tenantId}},select:{id:true,descrizione:true,quantitaOrdinata:true,quantitaRicevuta:true,...(req.partsFinancial?{prezzoUnitario:true}:{}),supplierOrder:{select:{fornitore:true,dataOrdine:true,dataConsegnaPrevista:true}}},orderBy:{id:"asc"}}):[],
  req.partsRole!=="TECNICO"?prisma.part.findMany({where:{tenantId},select:{id:true,codice:true,descrizione:true,fornitore:true},orderBy:{descrizione:"asc"}}):[]
 ]);
 res.json({parts:parts.map(p=>projectPart(p,req.partsFinancial)),duration:blockedDuration(intervals),intervals,canEdit:req.partsRole!=="TECNICO",canCheck:req.partsRole==="TECNICO",financial:req.partsFinancial,manualCosts:ledger?.data.costs.filter(c=>c.category==="ricambi")??[],orders,catalog});
}));
const bodySchema=z.object({version:z.number().int().min(0),status:z.enum(PART_STATES),reason:z.string().max(1000),data:z.record(z.unknown()),orderItemId:z.string().max(100).nullable(),catalogPartId:z.string().max(100).nullable()}).strict();
partsTrackingRouter.post("/vehicles/:id",writer,wrap(async(req,res)=>{
 if(!await allowedVehicle(req,req.params.id))throw problem(404,"Pratica non disponibile");
 const parsed=bodySchema.extend({requestKey:z.string().uuid()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});
 const saved=await saveTrackedPart({tenantId:req.auth.tenantId,vehicleId:req.params.id,actorId:req.auth.userId,financial:req.partsFinancial,...parsed.data});
 res.status(201).json({id:saved.id,version:saved.version});
}));
partsTrackingRouter.put("/parts/:partId",writer,wrap(async(req,res)=>{
 const part=await allowedPart(req);if(!part)throw problem(404,"Ricambio non disponibile");
 const parsed=bodySchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});
 const saved=await saveTrackedPart({tenantId:req.auth.tenantId,vehicleId:part.vehicleId,id:part.id,actorId:req.auth.userId,financial:req.partsFinancial,...parsed.data});
 res.json({id:saved.id,version:saved.version});
}));
partsTrackingRouter.post("/parts/:partId/status",wrap(async(req,res)=>{
 const part=await allowedPart(req);if(!part)throw problem(404,"Ricambio non disponibile");
 const parsed=z.object({version:z.number().int().positive(),status:z.enum(PART_STATES),reason:z.string().max(1000)}).strict().safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.flatten()});
 if(req.partsRole==="TECNICO"&&(!["CONTROLLATO","MONTATO"].includes(parsed.data.status)||PART_STATES.indexOf(parsed.data.status)!==PART_STATES.indexOf(part.status)+1))throw problem(403,"Il tecnico può confermare controllo e montaggio in sequenza");
 const saved=await saveTrackedPart({tenantId:req.auth.tenantId,vehicleId:part.vehicleId,id:part.id,actorId:req.auth.userId,financial:true,data:part.data,orderItemId:part.orderItemId,catalogPartId:part.catalogPartId,...parsed.data});
 res.json({id:saved.id,version:saved.version});
}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
partsTrackingRouter.post("/parts/:partId/documents",financial,wrap(async(req,res,next)=>{if(!await allowedPart(req))throw problem(404,"Ricambio non disponibile");next();}),upload.single("file"),wrap(async(req,res)=>{
 if(!req.file||!validDocument(req.file.buffer,req.file.mimetype))throw problem(400,"Caricare un PDF, JPEG o PNG valido (massimo 5 MB)");
 const doc=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM tracked_parts WHERE id=${req.params.partId} AND "tenantId"=${req.auth.tenantId} FOR UPDATE`;
  if(await tx.trackedPartDocument.count({where:{partId:req.params.partId,tenantId:req.auth.tenantId}})>=10)throw problem(400,"Massimo 10 documenti per ricambio");
  return tx.trackedPartDocument.create({data:{tenantId:req.auth.tenantId,partId:req.params.partId,name:req.file.originalname.slice(0,200),mime:req.file.mimetype,size:req.file.size,content:req.file.buffer},select:{id:true,name:true,size:true}});
 });
 res.status(201).json(doc);
}));
partsTrackingRouter.get("/documents/:docId",financial,wrap(async(req,res)=>{
 const doc=await prisma.trackedPartDocument.findFirst({where:{id:req.params.docId,tenantId:req.auth.tenantId,part:{tenantId:req.auth.tenantId,vehicle:scope(req)}}});
 if(!doc)throw problem(404,"Documento non disponibile");
 res.set({"Content-Type":doc.mime,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}).send(Buffer.from(doc.content));
}));
partsTrackingRouter.use((error,req,res,next)=>{
 if(error instanceof multer.MulterError)return res.status(400).json({error:"Documento troppo grande o caricamento non valido (massimo 5 MB)"});
 if(error.code==="P2002")return res.status(409).json({error:"Voce ordine già assegnata o richiesta già registrata"});
 if(error.status)return res.status(error.status).json({error:error.message});next(error);
});
