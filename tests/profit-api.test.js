import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {prisma} from '../src/lib/prisma.js';
import {profitRouter} from '../src/routes/profit.js';
import {emptyLedger} from '../src/lib/profit.js';
// Fully isolated database doubles: no connection or external notifications.
prisma.trackedPart.findMany=async()=>[];
prisma.loanerBooking.findMany=async()=>[];
process.env.JWT_SECRET='isolated-profit-test';
let role='ADMIN',record=null, conflict=false;
prisma.user.findFirst=async({where})=>where.tenantId==='tenant-a'?{ruolo:role}:null;
prisma.vehicle.findFirst=async({where})=>where.tenantId==='tenant-a'&&where.id==='vehicle-a'?{id:'vehicle-a',dataIngresso:new Date('2026-09-13'),quotes:[]}:null;
prisma.profitSettings.findUnique=async()=>null;
prisma.profitSettings.upsert=async({create})=>create;
prisma.profitRecord.findFirst=async({where})=>where.tenantId==='tenant-a'?record:null;
prisma.profitRecord.create=async({data})=>{if(record){const e=new Error('conflict');e.code='P2002';throw e;}record={...data,version:1};return record;};
prisma.profitRecord.updateMany=async({where,data})=>{assert.equal(where.tenantId,'tenant-a');if(conflict||record?.version!==where.version)return{count:0};record={...record,data:data.data,version:record.version+1};return{count:1};};
prisma.quote.findFirst=async()=>null;
prisma.profitRecord.findMany=async({where})=>{assert.equal(where.tenantId,'tenant-a');assert.equal(where.vehicle.tenantId,'tenant-a');return[];};
prisma.vehicle.count=async()=>3;
const app=express();app.use(express.json());app.use('/api/profit',profitRouter);app.use((err,req,res,next)=>res.status(500).json({error:err.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/api/profit`;
const call=(path,method='GET',body,token=true)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+jwt.sign({sub:'user-a',tenantId:'tenant-a',role:'ADMIN'},process.env.JWT_SECRET)}:{})},body:body?JSON.stringify(body):undefined});
test('API: auth, tenant, ruolo attuale, salvataggio, conflitto, preventivo e soglie',async()=>{
 try {
 assert.equal((await call('/vehicles/vehicle-a','GET',null,false)).status,401);
 role='TECNICO';assert.equal((await call('/vehicles/vehicle-a')).status,403);
 role='ACCETTATORE';assert.equal((await call('/dashboard')).status,403);
 role='ADMIN';assert.equal((await call('/vehicles/vehicle-b')).status,404);
 const empty=await (await call('/vehicles/vehicle-a')).json();assert.equal(empty.version,0);assert.equal(empty.summary.actualMargin,null);
 const data=emptyLedger('2026-09-13');data.revenue.preventivo=485000;
 assert.equal((await call('/vehicles/vehicle-a','PUT',{version:0,data})).status,200);
 assert.equal((await call('/vehicles/vehicle-a','PUT',{version:0,data})).status,409);
 assert.equal((await call('/vehicles/vehicle-a','PUT',{version:1,data})).status,200);
 assert.equal((await call('/vehicles/vehicle-a','PUT',{version:1,data})).status,409);
 assert.equal((await call('/vehicles/vehicle-a','PUT',{version:2,data:{...data,quoteId:'other-tenant-quote'}})).status,400);
 assert.equal((await call('/vehicles/vehicle-a','PUT',{version:2,data:{...data,tenantId:'other'}})).status,400);
 role='AMMINISTRAZIONE';assert.equal((await call('/vehicles/vehicle-a')).status,200);assert.equal((await call('/settings','PUT',{criticalBelow:10,goodFrom:30})).status,403);
 role='ADMIN';assert.equal((await call('/settings','PUT',{criticalBelow:40,goodFrom:20})).status,400);assert.equal((await call('/settings','PUT',{criticalBelow:10,goodFrom:30})).status,200);
 assert.equal((await call('/dashboard?group=bad')).status,400);assert.equal((await call('/dashboard?from=2026-10-01&to=2026-09-01')).status,400);
 const dash=await (await call('/dashboard')).json();assert.equal(dash.untracked,3);assert.equal(dash.totals,null);
 } finally {await new Promise(r=>server.close(r));await prisma.$disconnect();}
});
