import { partsProfitData } from "../lib/parts-tracking.js";
import { loanerProfitData } from "../lib/loaner.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { ledgerSchema, settingsSchema, DEFAULT_SETTINGS, emptyLedger, calculate, aggregate } from "../lib/profit.js";
export const profitRouter=Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
profitRouter.use(requireAuth);
// Check current account role, not only the role stored in a potentially stale JWT.
profitRouter.use((req,res,next)=>wrap(async(req,res)=>{
 const user=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId:req.auth.tenantId,attivo:true},select:{ruolo:true}});
 if(!user || !["ADMIN","AMMINISTRAZIONE"].includes(user.ruolo)) return res.status(403).json({error:"Profit Tracker riservato ad amministratore e amministrazione"});
 req.profitRole=user.ruolo;
 next();
})(req,res,next));

const settingsFor=async tenantId=>(await prisma.profitSettings.findUnique({where:{tenantId}}))??DEFAULT_SETTINGS;
profitRouter.get("/settings",wrap(async(req,res)=>res.json(await settingsFor(req.auth.tenantId))));
profitRouter.put("/settings",wrap(async(req,res)=>{
 if(req.profitRole!=="ADMIN") return res.status(403).json({error:"Solo l’amministratore può modificare le soglie"});
 const p=settingsSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:p.error.flatten()});
 res.json(await prisma.profitSettings.upsert({where:{tenantId:req.auth.tenantId},create:{tenantId:req.auth.tenantId,...p.data},update:p.data}));
}));
const vehicleInclude=tenantId=>({quotes:{where:{tenantId},select:{id:true,imponibile:true,stato:true,createdAt:true},orderBy:{createdAt:"desc"}},tecnico:{select:{nome:true,cognome:true}},sinistri:{where:{tenantId},select:{compagniaAssicurativa:true}}});
profitRouter.get("/dashboard",wrap(async(req,res)=>{
 const p=z.object({group:z.enum(["day","week","month","year","technician","insurance","workType"]).default("month"),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).safeParse(req.query);
 if(!p.success || (p.data.from && p.data.to && p.data.from>p.data.to)) return res.status(400).json({error:"Filtri non validi"});
 const tenantId=req.auth.tenantId, settings=await settingsFor(tenantId);
 const all=await prisma.profitRecord.findMany({where:{tenantId,vehicle:{tenantId}},include:{vehicle:{include:vehicleInclude(tenantId)}}});
 const tracked=await prisma.trackedPart.findMany({where:{tenantId}});
 const loanerBookings=await prisma.loanerBooking.findMany({where:{tenantId,attribuitaAllaPratica:true,costoTotaleCents:{not:null}},include:{loanerCar:{select:{marca:true,modello:true,targa:true}}}});
 const loanerByVehicle={};for(const b of loanerBookings)(loanerByVehicle[b.vehicleId]||=[]).push(b);
 const records=all.map(r=>{const withParts=partsProfitData(r.data,tracked.filter(p=>p.vehicleId===r.vehicleId)).data;const withLoaner=loanerProfitData(withParts,loanerByVehicle[r.vehicleId]||[]).data;return {...r,data:withLoaner};}).filter(r=>(!p.data.from || r.data.date>=p.data.from)&&(!p.data.to || r.data.date<=p.data.to));
 const count=await prisma.vehicle.count({where:{tenantId}});
 res.json({settings,untracked:count-all.length,groups:aggregate(records,p.data.group,settings),
  totals:aggregate(records.map(r=>({...r,data:{...r.data,workType:"Totale"}})),"workType",settings)[0]??null,
  records:records.map(r=>({vehicleId:r.vehicleId,label:`${r.vehicle.marca} ${r.vehicle.modello} · ${r.vehicle.targa}`,date:r.data.date,...calculate(r.data,r.vehicle.quotes,settings)}))});
}));
profitRouter.get("/vehicles/:id",wrap(async(req,res)=>{
 const tenantId=req.auth.tenantId;
 const vehicle=await prisma.vehicle.findFirst({where:{id:req.params.id,tenantId},include:vehicleInclude(tenantId)});
 if(!vehicle) return res.status(404).json({error:"Pratica non trovata"});
 const record=await prisma.profitRecord.findFirst({where:{vehicleId:vehicle.id,tenantId}}), settings=await settingsFor(tenantId);
 const data=record?.data??emptyLedger(new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Rome"}).format(vehicle.dataIngresso));
 const tracked=await prisma.trackedPart.findMany({where:{tenantId,vehicleId:vehicle.id}});
 const merged=partsProfitData(data,tracked);
 const loanerBookings=await prisma.loanerBooking.findMany({where:{tenantId,vehicleId:vehicle.id,attribuitaAllaPratica:true,costoTotaleCents:{not:null}},include:{loanerCar:{select:{marca:true,modello:true,targa:true}}}});
 const loaner=loanerProfitData(merged.data,loanerBookings);
 res.json({data,version:record?.version??0,updatedAt:record?.updatedAt??null,settings,quotes:vehicle.quotes,automaticCosts:[...merged.automaticCosts,...loaner.automaticCosts],replacedCostIds:merged.replacedCostIds,partsPlannedMissing:merged.plannedMissing,partsActualMissing:merged.actualMissing,loanerCosts:loaner.automaticCosts,summary:calculate(loaner.data,vehicle.quotes,settings)});
}));
profitRouter.put("/vehicles/:id",wrap(async(req,res)=>{
 const p=z.object({version:z.number().int().min(0),data:ledgerSchema}).strict().safeParse(req.body);
 if(!p.success) return res.status(400).json({error:p.error.flatten()});
 const tenantId=req.auth.tenantId;
 const vehicle=await prisma.vehicle.findFirst({where:{id:req.params.id,tenantId},select:{id:true}});
 if(!vehicle) return res.status(404).json({error:"Pratica non trovata"});
 if(p.data.data.quoteId && !await prisma.quote.findFirst({where:{id:p.data.data.quoteId,vehicleId:vehicle.id,tenantId,stato:{not:"RIFIUTATO"}},select:{id:true}})) return res.status(400).json({error:"Preventivo non valido per questa pratica"});
 const changes={data:p.data.data,updatedById:req.auth.userId};
 try {
  if(p.data.version===0) await prisma.profitRecord.create({data:{tenantId,vehicleId:vehicle.id,...changes}});
  else {
   const result=await prisma.profitRecord.updateMany({where:{tenantId,vehicleId:vehicle.id,version:p.data.version},data:{...changes,version:{increment:1}}});
   if(!result.count) return res.status(409).json({error:"La pratica è stata modificata da un altro operatore. Ricarica prima di salvare."});
  }
 } catch(e) {if(e.code==="P2002") return res.status(409).json({error:"Pratica già aggiornata: ricarica i dati"});throw e;}
 res.json({ok:true,version:p.data.version+1});
}));
