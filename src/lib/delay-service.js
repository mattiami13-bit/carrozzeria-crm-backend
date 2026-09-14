import { trackingDependencies } from "./parts-tracking.js";
import { refreshLinkedParts } from "./parts-tracking-service.js";
import {createHash} from "node:crypto";
import {prisma} from "./prisma.js";
import {defaultSettings,emptyPlan,operationalHours,resolveDependencies,predict,day,MODEL_VERSION} from "./delay.js";
export async function delayContext(tenantId){
 await refreshLinkedParts(tenantId);
 const [config,vehicles,plans,profits,staff,appointments,items,history,trackedParts]=await Promise.all([
  prisma.delaySettings.findUnique({where:{tenantId}}),
  prisma.vehicle.findMany({where:{tenantId},select:{id:true,marca:true,modello:true,targa:true,stage:true,dataIngresso:true,dataPrevistaConsegna:true,dataConsegnaEffettiva:true,tecnicoId:true,stageHistory:{select:{changedAt:true},orderBy:{changedAt:"desc"},take:1}},orderBy:{id:"asc"}}),
  prisma.delayPlan.findMany({where:{tenantId},orderBy:{vehicleId:"asc"}}),prisma.profitRecord.findMany({where:{tenantId},select:{vehicleId:true,data:true}}),
  prisma.user.findMany({where:{tenantId,attivo:true},select:{id:true,nome:true,cognome:true,ruolo:true},orderBy:{id:"asc"}}),
  prisma.appointment.findMany({where:{tenantId,fine:{gte:new Date()}},select:{id:true,tecnicoId:true,vehicleId:true,inizio:true,fine:true},orderBy:{id:"asc"}}),
  prisma.supplierOrderItem.findMany({where:{supplierOrder:{tenantId}},select:{id:true,descrizione:true,quantitaRicevuta:true,quantitaOrdinata:true,supplierOrder:{select:{id:true,dataConsegnaPrevista:true}}},orderBy:{id:"asc"}}),
  prisma.stageHistory.findMany({where:{vehicle:{tenantId,dataConsegnaEffettiva:{not:null}}},select:{vehicleId:true,toStage:true,changedAt:true,vehicle:{select:{dataConsegnaEffettiva:true}}},orderBy:{changedAt:"desc"},take:5000}),
  prisma.trackedPart.findMany({where:{tenantId},orderBy:{id:"asc"}})
 ]);
 const settings=config?.data??defaultSettings();
 const operationalSettings={...settings,technicians:settings.technicians.filter(t=>staff.some(u=>u.id===t.userId))};
 const records=vehicles.map(v=>{const plan=plans.find(p=>p.vehicleId===v.id),data=plan?.data??emptyPlan(),profit=profits.find(p=>p.vehicleId===v.id)?.data;return {...v,plan:data,version:plan?.version??0,operational:operationalHours(data,profit)};});
 return {tenantId,trackedParts,settings:operationalSettings,settingsVersion:config?.version??0,staff,appointments,items,history,records};
}
export async function forecastVehicle(ctx,id){
 const v=ctx.records.find(v=>v.id===id);if(!v)return null;
 if(v.stage==="CONSEGNATA"||v.dataConsegnaEffettiva)return prisma.delayForecast.findFirst({where:{tenantId:ctx.tenantId,vehicleId:id},orderBy:{createdAt:"desc"}});
 const now=new Date(Math.floor(Date.now()/900000)*900000);
 const active=ctx.records.filter(v=>v.stage!=="CONSEGNATA"&&!v.dataConsegnaEffettiva);
 const priority=v=>[v.dataPrevistaConsegna?day(v.dataPrevistaConsegna):"9999",new Date(v.dataIngresso).toISOString(),v.id].join("|");
 const ahead=active.filter(x=>x.id!==id&&priority(x)<priority(v));
 const queue=Object.fromEntries(v.operational.rows.map(h=>[h.department,ahead.reduce((a,x)=>{const row=x.operational.rows.find(r=>r.department===h.department);return a+(row.planned!==null&&row.completed!==null?Math.max(0,row.planned-row.completed):0);},0)]));
 const seen=new Set();const history=ctx.history.filter(h=>{
  if(h.vehicleId===id||h.toStage!==v.stage||seen.has(h.vehicleId)||new Date(h.vehicle.dataConsegnaEffettiva)>now)return false;
  seen.add(h.vehicleId);return true;
 }).map(h=>(new Date(h.vehicle.dataConsegnaEffettiva)-new Date(h.changedAt))/86400000).filter(n=>n>=0);
 const tracked=ctx.trackedParts.filter(p=>p.vehicleId===v.id&&!p.data.cancelled);
 const manualPlan={...v.plan,dependencies:v.plan.dependencies.filter(d=>!d.orderItemId||!tracked.some(p=>p.orderItemId===d.orderItemId))};
 const input={vehicle:{id:v.id,stage:v.stage,dataIngresso:v.dataIngresso,dataPrevistaConsegna:v.dataPrevistaConsegna,stageEnteredAt:v.stageHistory[0]?.changedAt??v.dataIngresso,tecnicoId:v.tecnicoId},settings:ctx.settings,now,
  hours:v.operational.rows,hoursSource:v.operational.source,dependencies:[...resolveDependencies(manualPlan,ctx.items),...trackingDependencies(tracked)],depsReviewed:v.plan.dependenciesReviewed,history,queue,appointments:ctx.appointments,
  accountedVehicleIds:active.filter(x=>x.operational.rows.every(h=>h.planned!==null&&h.completed!==null)).map(x=>x.id),unknownWorkload:active.filter(x=>x.id!==id&&x.operational.rows.some(h=>h.planned===null||h.completed===null)).length};
 const result=predict(input);
 const snapshot=JSON.parse(JSON.stringify(input));
 const fingerprint=createHash("sha256").update(JSON.stringify({model:MODEL_VERSION,input:snapshot})).digest("hex");
 return prisma.delayForecast.upsert({where:{vehicleId_fingerprint:{vehicleId:id,fingerprint}},update:{},create:{tenantId:ctx.tenantId,vehicleId:id,fingerprint,modelVersion:MODEL_VERSION,promisedAt:v.dataPrevistaConsegna,estimatedDate:result.estimatedDate,risk:result.risk,input:snapshot,result}});
}
let working=false;
export async function refreshDelayForecasts(){
 if(working)return;working=true;
 try{
  // Only configured tenants participate; settings and plans opt a workshop into scheduled forecasting.
  const tenants=await prisma.tenant.findMany({where:{OR:[{delaySettings:{isNot:null}},{delayPlans:{some:{}}}]},select:{id:true}});
  for(const {id} of tenants){try{const ctx=await delayContext(id);for(const v of ctx.records)if(v.stage!=="CONSEGNATA"&&!v.dataConsegnaEffettiva)await forecastVehicle(ctx,v.id);}catch(e){console.error("Predictive Delay: aggiornamento tenant fallito",e.code??e.name);}}
 }finally{working=false;}
}
export function startDelayWorker(){const run=()=>refreshDelayForecasts().catch(e=>console.error("Predictive Delay: aggiornamento fallito",e.code??e.name));run();const timer=setInterval(run,15*60*1000);timer.unref();return timer;}
