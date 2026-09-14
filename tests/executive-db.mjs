import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/prisma.js';
import {executiveContext} from '../src/routes/executive.js';
import {buildExecutive} from '../src/lib/executive.js';
const rollback=new Error('ROLLBACK_EXECUTIVE_TEST');
try{await prisma.$transaction(async tx=>{
 const t=await tx.tenant.create({data:{ragioneSociale:'Verifica transitoria Executive'}}),other=await tx.tenant.create({data:{ragioneSociale:'Altro tenant transitorio'}});
 const c=await tx.client.create({data:{tenantId:t.id,nome:'Test',cognome:'Executive'}}),v=await tx.vehicle.create({data:{tenantId:t.id,clientId:c.id,marca:'TEST',modello:'Executive',targa:'TEST-EXEC',dataIngresso:new Date('2026-09-02T08:00Z')}});
 const u=await tx.user.create({data:{tenantId:t.id,nome:'Tecnico',cognome:'Test',email:randomUUID()+'@example.invalid',passwordHash:'unusable-test-only',ruolo:'TECNICO'}});
 const w=await tx.workOrder.create({data:{tenantId:t.id,vehicleId:v.id,tecnicoId:u.id,titolo:'Test transitorio',reparto:'CARROZZERIA',oreStimate:2}});
 await tx.workOrderTimeEntry.create({data:{tenantId:t.id,workOrderId:w.id,tecnicoId:u.id,inizio:new Date('2026-09-14T08:00Z'),fine:new Date('2026-09-14T09:00Z')}});
 const ctx=await executiveContext(tx,t.id),empty=await executiveContext(tx,other.id);assert.equal(empty.vehicles.length,0);assert.equal(empty.workOrders.length,0);
 const result=buildExecutive(ctx,{period:'MESE'},new Date('2026-09-14T12:00Z'));assert.equal(result.kpis.find(k=>k.id==='arrived').value,1);assert.equal(result.kpis.find(k=>k.id==='workedHours').value,1);assert.equal(result.kpis.find(k=>k.id==='workedHours').rows[0].vehicleId,v.id);assert.equal(result.kpis.find(k=>k.id==='revenue').value,null);
 throw rollback;
},{timeout:30000});}catch(e){if(e!==rollback)throw e;console.log('Database: query Executive, isolamento tenant, timer e drill-down verificati. Dati transitori annullati integralmente.');}finally{await prisma.$disconnect();}
