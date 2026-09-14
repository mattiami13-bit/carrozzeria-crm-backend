import 'dotenv/config';
import assert from 'node:assert/strict';
import {prisma} from '../src/lib/prisma.js';
import {emptyPlan,defaultSettings} from '../src/lib/delay.js';
const rollback=new Error('ROLLBACK_DELAY_TEST');
try{await prisma.$transaction(async tx=>{
 const tenant=await tx.tenant.create({data:{ragioneSociale:'Verifica transitoria Predictive Delay'}});
 const client=await tx.client.create({data:{tenantId:tenant.id,nome:'Test',cognome:'Transitorio'}});
 const promised=new Date('2026-09-16T12:00Z');
 const v=await tx.vehicle.create({data:{tenantId:tenant.id,clientId:client.id,marca:'TEST',modello:'TEST',targa:'TEST-DELAY',dataPrevistaConsegna:promised}});
 await tx.delaySettings.create({data:{tenantId:tenant.id,data:defaultSettings()}});
 await tx.delayPlan.create({data:{tenantId:tenant.id,vehicleId:v.id,data:emptyPlan(),updatedById:'test'}});
 const f=await tx.delayForecast.create({data:{tenantId:tenant.id,vehicleId:v.id,fingerprint:'test',modelVersion:'test',risk:70,promisedAt:promised,estimatedDate:'2026-09-18',input:{},result:{}}});
 const actual=new Date('2026-09-18T12:00Z');
 await tx.vehicle.update({where:{id:v.id},data:{stage:'CONSEGNATA',dataConsegnaEffettiva:actual}});
 const after=await tx.delayForecast.findUnique({where:{id:f.id}});
 assert.equal(after.actualDeliveredAt.toISOString(),actual.toISOString());assert.equal(after.promisedAt.toISOString(),promised.toISOString());assert.equal(after.risk,70);
 const concurrent=await tx.delayForecast.create({data:{tenantId:tenant.id,vehicleId:v.id,fingerprint:'race',modelVersion:'test',risk:80,promisedAt:promised,input:{},result:{}}});
 assert.equal(concurrent.actualDeliveredAt.toISOString(),actual.toISOString());
 await tx.delayDecision.create({data:{tenantId:tenant.id,vehicleId:v.id,forecastId:f.id,action:'REVISE',proposedDate:'2026-09-20',note:'Test',userId:'test'}});
 const unchanged=await tx.vehicle.findUnique({where:{id:v.id}});assert.equal(unchanged.dataPrevistaConsegna.toISOString(),promised.toISOString());
 throw rollback;
},{timeout:20000});}catch(e){if(e!==rollback)throw e;console.log('Database: esito reale registrato, previsione originale e promessa conservate, inserimento concorrente coperto. Test annullato integralmente.');}finally{await prisma.$disconnect();}
