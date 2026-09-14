import {Router} from "express";
import {z} from "zod";
import {prisma} from "../lib/prisma.js";
import {requireAuth} from "../middleware/auth.js";
import {planSchema,settingsSchema,dateSchema,defaultSettings,accuracy} from "../lib/delay.js";
import {delayContext,forecastVehicle} from "../lib/delay-service.js";
export const delayRouter=Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
delayRouter.use(requireAuth);
delayRouter.use(wrap(async(req,res,next)=>{
 const user=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId:req.auth.tenantId,attivo:true},select:{ruolo:true}});
 if(!user)return res.status(403).json({error:"Account non attivo"});
 req.delayRole=user.ruolo;next();
}));
const writeAccess=(req,res,next)=>["ADMIN","AMMINISTRAZIONE","ACCETTATORE"].includes(req.delayRole)?next():res.status(403).json({error:"Solo responsabili e accettazione possono modificare le previsioni"});
const admin=(req,res,next)=>req.delayRole==="ADMIN"?next():res.status(403).json({error:"Solo amministratore"});
const bad=(res,p)=>res.status(400).json({error:p.error.flatten()});
const vehicleScope=req=>({tenantId:req.auth.tenantId,...(req.delayRole==="TECNICO"?{tecnicoId:req.auth.userId}:{})});
const allowedVehicle=async req=>prisma.vehicle.findFirst({where:{id:req.params.id,...vehicleScope(req)},select:{id:true}});
const publicForecast=f=>f?{id:f.id,risk:f.risk,estimatedDate:f.estimatedDate,createdAt:f.createdAt,promisedAt:f.promisedAt,actualDeliveredAt:f.actualDeliveredAt,result:f.result}:null;
delayRouter.get("/settings",admin,wrap(async(req,res)=>{
 const config=await prisma.delaySettings.findUnique({where:{tenantId:req.auth.tenantId}});
 const staff=await prisma.user.findMany({where:{tenantId:req.auth.tenantId,attivo:true},select:{id:true,nome:true,cognome:true},orderBy:{nome:"asc"}});
 res.json({data:config?.data??defaultSettings(),version:config?.version??0,staff});
}));
delayRouter.put("/settings",admin,wrap(async(req,res)=>{
 const p=z.object({version:z.number().int().min(0),data:settingsSchema}).strict().safeParse(req.body);if(!p.success)return bad(res,p);
 const tenantId=req.auth.tenantId,ids=p.data.data.technicians.map(t=>t.userId);
 if(await prisma.user.count({where:{tenantId,attivo:true,id:{in:ids}}})!==ids.length)return res.status(400).json({error:"Tecnici non validi per questa carrozzeria"});
 try{
  if(p.data.version===0)await prisma.delaySettings.create({data:{tenantId,data:p.data.data}});
  else if(!(await prisma.delaySettings.updateMany({where:{tenantId,version:p.data.version},data:{data:p.data.data,version:{increment:1}}})).count)return res.status(409).json({error:"Configurazione modificata: ricaricare"});
 }catch(e){if(e.code==="P2002")return res.status(409).json({error:"Configurazione già creata: ricaricare"});throw e;}
 res.json({ok:true});
}));
delayRouter.get("/dashboard",wrap(async(req,res)=>{
 const ctx=await delayContext(req.auth.tenantId),rows=[];
 for(const v of ctx.records.filter(v=>req.delayRole!=="TECNICO"||v.tecnicoId===req.auth.userId)){
  const f=await forecastVehicle(ctx,v.id);rows.push({vehicleId:v.id,label:`${v.marca} ${v.modello} · ${v.targa}`,delivered:!!v.dataConsegnaEffettiva||v.stage==="CONSEGNATA",forecast:publicForecast(f)});
 }
 const forecasts=req.delayRole==="TECNICO"?[]:await prisma.delayForecast.findMany({where:{tenantId:req.auth.tenantId,actualDeliveredAt:{not:null}},select:{vehicleId:true,risk:true,createdAt:true,promisedAt:true,estimatedDate:true,actualDeliveredAt:true}});
 res.json({rows,accuracy:req.delayRole==="TECNICO"?null:accuracy(forecasts)});
}));
delayRouter.get("/vehicles/:id",wrap(async(req,res)=>{
 if(!await allowedVehicle(req))return res.status(404).json({error:"Pratica non disponibile"});
 const ctx=await delayContext(req.auth.tenantId),v=ctx.records.find(v=>v.id===req.params.id),forecast=await forecastVehicle(ctx,v.id);
 const [initial,history,decisions]=await Promise.all([
  prisma.delayForecast.findFirst({where:{tenantId:ctx.tenantId,vehicleId:v.id},orderBy:{createdAt:"asc"}}),
  prisma.delayForecast.findMany({where:{tenantId:ctx.tenantId,vehicleId:v.id},orderBy:{createdAt:"desc"},take:20}),
  prisma.delayDecision.findMany({where:{tenantId:ctx.tenantId,vehicleId:v.id},orderBy:{createdAt:"desc"},take:20})
 ]);
 res.json({data:v.plan,version:v.version,forecast:publicForecast(forecast),initial:publicForecast(initial),history:history.map(publicForecast),decisions,canEdit:req.delayRole!=="TECNICO",delivered:!!v.dataConsegnaEffettiva||v.stage==="CONSEGNATA",
  hoursSource:v.operational.source,operationalHours:v.operational.rows,
  orderItems:req.delayRole==="TECNICO"?[]:ctx.items.map(i=>({id:i.id,description:i.descrizione,missing:Math.max(0,i.quantitaOrdinata-i.quantitaRicevuta)}))});
}));
delayRouter.put("/vehicles/:id",writeAccess,wrap(async(req,res)=>{
 if(!await allowedVehicle(req))return res.status(404).json({error:"Pratica non disponibile"});
 const p=z.object({version:z.number().int().min(0),data:planSchema}).strict().safeParse(req.body);if(!p.success)return bad(res,p);
 const tenantId=req.auth.tenantId,ids=[...new Set(p.data.data.dependencies.map(d=>d.orderItemId).filter(Boolean))];
 if(await prisma.supplierOrderItem.count({where:{id:{in:ids},supplierOrder:{tenantId}}})!==ids.length)return res.status(400).json({error:"Voce ordine estranea alla carrozzeria"});
 const data={data:p.data.data,updatedById:req.auth.userId};
 try{
  if(p.data.version===0)await prisma.delayPlan.create({data:{tenantId,vehicleId:req.params.id,...data}});
  else if(!(await prisma.delayPlan.updateMany({where:{tenantId,vehicleId:req.params.id,version:p.data.version},data:{...data,version:{increment:1}}})).count)return res.status(409).json({error:"Dati modificati da un altro operatore: ricaricare"});
 }catch(e){if(e.code==="P2002")return res.status(409).json({error:"Dati già creati: ricaricare"});throw e;}
 await forecastVehicle(await delayContext(tenantId),req.params.id);res.json({ok:true});
}));
delayRouter.post("/vehicles/:id/decisions",writeAccess,wrap(async(req,res)=>{
 if(!await allowedVehicle(req))return res.status(404).json({error:"Pratica non disponibile"});
 const p=z.object({forecastId:z.string(),action:z.enum(["KEEP","REVISE","DRAFT"]),proposedDate:dateSchema.nullable(),note:z.string().max(2000)}).strict().refine(d=>d.action!=="REVISE"||d.proposedDate!==null,"Inserire la nuova previsione").safeParse(req.body);if(!p.success)return bad(res,p);
 const tenantId=req.auth.tenantId,forecast=await prisma.delayForecast.findFirst({where:{id:p.data.forecastId,tenantId,vehicleId:req.params.id}});
 if(!forecast)return res.status(404).json({error:"Previsione non disponibile"});
 // Append-only decision: never writes Vehicle.dataPrevistaConsegna and never sends a message.
 const decision=await prisma.delayDecision.create({data:{tenantId,vehicleId:req.params.id,userId:req.auth.userId,...p.data}});
 res.status(201).json({decision});
}));
