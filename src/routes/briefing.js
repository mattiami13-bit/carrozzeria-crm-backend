import {Router} from 'express';
import {z} from 'zod';
import {prisma} from '../lib/prisma.js';
import {requireAuth} from '../middleware/auth.js';
import {briefingDefaults,briefingSettingsSchema} from '../lib/briefing.js';
import {currentBriefing,ensureBriefings} from '../lib/briefing-service.js';
export const briefingRouter=Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
briefingRouter.use(requireAuth,wrap(async(req,res,next)=>{
 const user=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId:req.auth.tenantId,attivo:true},select:{ruolo:true}});
 if(user?.ruolo!=='ADMIN')return res.status(403).json({error:'Briefing riservato al titolare/amministratore'});
 res.set('Cache-Control','no-store');next();
}));
briefingRouter.get('/',wrap(async(req,res)=>{
 const tenantId=req.auth.tenantId;
 await ensureBriefings(tenantId);
 const [live,settings,reports]=await Promise.all([currentBriefing(tenantId),prisma.briefingSettings.findUnique({where:{tenantId}}),prisma.briefingReport.findMany({where:{tenantId},orderBy:{createdAt:'desc'},take:30,include:{resolutions:true}})]);
 res.json({live,settings:settings?.data||briefingDefaults,reports});
}));
briefingRouter.put('/settings',wrap(async(req,res)=>{
 const parsed=briefingSettingsSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Orari non validi; il riepilogo serale deve seguire quello mattutino'});
 const tenantId=req.auth.tenantId;
 await prisma.briefingSettings.upsert({where:{tenantId},create:{tenantId,data:parsed.data},update:{data:parsed.data}});res.json(parsed.data);
}));
briefingRouter.post('/:id/resolve',wrap(async(req,res)=>{
 const parsed=z.object({actionKey:z.string().min(1).max(200),note:z.string().trim().min(3).max(1000)}).strict().safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Indicare l’azione e una nota di gestione (3–1000 caratteri)'});
 const report=await prisma.briefingReport.findFirst({where:{id:req.params.id,tenantId:req.auth.tenantId}});
 if(!report||!report.data.actions.some(a=>a.key===parsed.data.actionKey))return res.status(404).json({error:'Suggerimento non trovato'});
 const data={reportId:report.id,...parsed.data,userId:req.auth.userId};
 const result=await prisma.briefingResolution.upsert({where:{reportId_actionKey:{reportId:report.id,actionKey:data.actionKey}},create:data,update:{}});
 res.json(result);
}));
