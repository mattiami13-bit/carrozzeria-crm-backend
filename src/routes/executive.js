import {Router} from 'express';
import {prisma} from '../lib/prisma.js';
import {requireAuth} from '../middleware/auth.js';
import {buildExecutive,executivePeriod} from '../lib/executive.js';
export const executiveRouter=Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
executiveRouter.use(requireAuth);
executiveRouter.get('/',wrap(async(req,res)=>{
 const tenantId=req.auth.tenantId,user=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId,attivo:true},select:{ruolo:true}});
 if(user?.ruolo!=='ADMIN')return res.status(403).json({error:'Executive Dashboard riservata al titolare/amministratore'});
 const now=new Date();try{executivePeriod(req.query,now);}catch{return res.status(400).json({error:'Periodo non valido: massimo 366 giorni, senza date future'});}
 const ctx=await prisma.$transaction(tx=>executiveContext(tx,tenantId),{isolationLevel:'RepeatableRead',timeout:20000});
 res.set('Cache-Control','no-store').json(buildExecutive(ctx,req.query,now));
}));
export async function executiveContext(tx,tenantId){
 const [vehicles,profits,parts,workOrders,config,staff]=await Promise.all([
  tx.vehicle.findMany({where:{tenantId},select:{id:true,marca:true,modello:true,targa:true,stage:true,dataIngresso:true,dataPrevistaConsegna:true,dataConsegnaEffettiva:true,quotes:{where:{tenantId},select:{id:true,stato:true,createdAt:true,imponibile:true}},stageHistory:{select:{toStage:true,changedAt:true}},partBlocks:{where:{tenantId},select:{startedAt:true,endedAt:true}}}}),
  tx.profitRecord.findMany({where:{tenantId,vehicle:{tenantId}},select:{vehicleId:true,data:true}}),
  tx.trackedPart.findMany({where:{tenantId,vehicle:{tenantId}},select:{id:true,vehicleId:true,data:true,createdAt:true,status:true}}),
  tx.workOrder.findMany({where:{tenantId,vehicle:{tenantId}},select:{id:true,vehicleId:true,tecnicoId:true,titolo:true,stato:true,oreStimate:true,timeEntries:{where:{tenantId},select:{tecnicoId:true,inizio:true,fine:true}},eventi:{where:{tenantId},select:{tipo:true,aStato:true,createdAt:true}}}}),
  tx.delaySettings.findUnique({where:{tenantId}}),
  tx.user.findMany({where:{tenantId,attivo:true,ruolo:'TECNICO'},select:{id:true}})
 ]);
 const settings=config?.data?{...config.data,technicians:config.data.technicians.filter(t=>staff.some(u=>u.id===t.userId))}:null;
 return {vehicles,profits,parts,workOrders,settings};
}
