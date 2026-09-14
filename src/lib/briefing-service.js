import {prisma} from './prisma.js';
import {buildBriefing,briefingDefaults,dueBriefings} from './briefing.js';
import {day} from './delay.js';

export async function briefingContext(tx,tenantId){
 const [vehicles,parts,workOrders,config,staff,appointments]=await Promise.all([
  tx.vehicle.findMany({where:{tenantId},select:{id:true,marca:true,modello:true,targa:true,stage:true,dataPrevistaConsegna:true,dataConsegnaEffettiva:true,quotes:{where:{tenantId},select:{id:true,stato:true,imponibile:true}},delayForecasts:{where:{tenantId},orderBy:{createdAt:'desc'},take:1,select:{createdAt:true,promisedAt:true,risk:true,result:true}}}}),
  tx.trackedPart.findMany({where:{tenantId,vehicle:{tenantId}},select:{id:true,vehicleId:true,data:true,status:true}}),
  tx.workOrder.findMany({where:{tenantId,vehicle:{tenantId}},select:{id:true,vehicleId:true,titolo:true,reparto:true,tecnicoId:true,stato:true,dataConsegna:true,oreStimate:true,timeEntries:{where:{tenantId},select:{tecnicoId:true,inizio:true,fine:true}},eventi:{where:{tenantId},select:{tipo:true,createdAt:true}}}}),
  tx.delaySettings.findUnique({where:{tenantId}}),
  tx.user.findMany({where:{tenantId,attivo:true,ruolo:'TECNICO'},select:{id:true}}),
  tx.appointment.findMany({where:{tenantId,fine:{gte:new Date()}},select:{vehicleId:true,tecnicoId:true,inizio:true,fine:true}})
 ]);
 return {vehicles,parts,workOrders,appointments,settings:config?.data?{...config.data,technicians:config.data.technicians.filter(t=>staff.some(u=>u.id===t.userId))}:null};
}
export async function currentBriefing(tenantId,now=new Date(),kind='live'){
 return prisma.$transaction(async tx=>{
  const ctx=await briefingContext(tx,tenantId);
  const morning=await tx.briefingReport.findUnique({where:{tenantId_day_kind:{tenantId,day:day(now),kind:'morning'}}});
  return buildBriefing(ctx,now,kind,morning?.data);
 },{isolationLevel:'RepeatableRead',timeout:30000});
}
export async function ensureBriefings(tenantId,now=new Date()){
 const saved=await prisma.briefingSettings.findUnique({where:{tenantId}}),settings=saved?.data||briefingDefaults;
 for(const kind of dueBriefings(settings,now)){
  const key={tenantId,day:day(now),kind};
  if(await prisma.briefingReport.findUnique({where:{tenantId_day_kind:key},select:{id:true}}))continue;
  const data=await currentBriefing(tenantId,now,kind);
  // A unique key arbitrates concurrent workers; an existing snapshot is immutable.
  try{await prisma.briefingReport.create({data:{...key,data}});}catch(e){if(e.code!=='P2002')throw e;}
 }
}
let running=false;
export async function refreshBriefings(){
 if(running)return;running=true;
 try{const tenants=await prisma.tenant.findMany({where:{users:{some:{attivo:true,ruolo:'ADMIN'}}},select:{id:true}});
  for(const t of tenants)try{await ensureBriefings(t.id);}catch(e){console.error('Briefing non generato; nuovo tentativo tra un minuto',e.code||e.name);}
 }finally{running=false;}
}
export function startBriefingWorker(){const run=()=>refreshBriefings().catch(e=>console.error('Briefing worker',e.code||e.name));run();const timer=setInterval(run,60000);timer.unref();return timer;}
