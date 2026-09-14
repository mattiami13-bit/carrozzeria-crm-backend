import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/prisma.js';
import {briefingContext} from '../src/lib/briefing-service.js';
import {buildBriefing,briefingDefaults} from '../src/lib/briefing.js';
const rollback=new Error('ROLLBACK_BRIEFING_TEST');
try{await prisma.$transaction(async tx=>{
 const t=await tx.tenant.create({data:{ragioneSociale:'Verifica transitoria Briefing'}}),other=await tx.tenant.create({data:{ragioneSociale:'Altro tenant transitorio'}});
 const c=await tx.client.create({data:{tenantId:t.id,nome:'Test',cognome:'Briefing'}}),v=await tx.vehicle.create({data:{tenantId:t.id,clientId:c.id,marca:'TEST',modello:'Briefing',targa:'TEST-BRIEF',dataPrevistaConsegna:new Date('2026-09-14T12:00Z')}});
 const u=await tx.user.create({data:{tenantId:t.id,nome:'Tecnico',cognome:'Test',email:randomUUID()+'@example.invalid',passwordHash:'unusable-test-only',ruolo:'TECNICO'}});
 const w=await tx.workOrder.create({data:{tenantId:t.id,vehicleId:v.id,tecnicoId:u.id,titolo:'Test transitorio',reparto:'CARROZZERIA',oreStimate:0.5}});
 await tx.workOrderTimeEntry.create({data:{tenantId:t.id,workOrderId:w.id,tecnicoId:u.id,inizio:new Date('2026-09-14T08:00Z'),fine:new Date('2026-09-14T09:00Z')}});
 const ctx=await briefingContext(tx,t.id),empty=await briefingContext(tx,other.id);assert.equal(empty.vehicles.length,0);assert.equal(empty.workOrders.length,0);
 const result=buildBriefing(ctx,new Date('2026-09-14T12:00Z'),'morning');assert.equal(result.metrics.deliveries.value,1);assert.equal(result.actions[0].key,'hours:'+w.id);
 await tx.briefingSettings.create({data:{tenantId:t.id,data:briefingDefaults}});
 const report=await tx.briefingReport.create({data:{tenantId:t.id,day:result.day,kind:'morning',data:result}});
 await tx.briefingResolution.create({data:{reportId:report.id,actionKey:result.actions[0].key,userId:u.id,note:'Controllato per test'}});
 const saved=await tx.briefingReport.findUnique({where:{tenantId_day_kind:{tenantId:t.id,day:result.day,kind:'morning'}},include:{resolutions:true}});assert.equal(saved.resolutions.length,1);assert.equal(saved.data.actions[0].vehicleId,v.id);
 assert.equal(await tx.briefingReport.count({where:{tenantId:other.id}}),0);
 throw rollback;
},{timeout:30000});}catch(e){if(e!==rollback)throw e;console.log('Database: query operative, isolamento tenant, briefing e risoluzioni verificati; dati transitori annullati integralmente.');}finally{await prisma.$disconnect();}
