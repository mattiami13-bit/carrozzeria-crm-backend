import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {prisma} from '../src/lib/prisma.js';
import {executiveRouter} from '../src/routes/executive.js';
process.env.JWT_SECRET='isolated-executive-tests';let role='ADMIN',reads=0;
prisma.user.findFirst=async({where})=>{assert.equal(where.tenantId,'a');assert.equal(where.attivo,true);return role?{ruolo:role}:null;};
for(const name of ['vehicle','profitRecord','trackedPart','workOrder'])prisma[name].findMany=async({where})=>{assert.equal(where.tenantId,'a');reads++;return[];};
prisma.user.findMany=async({where})=>{assert.equal(where.tenantId,'a');return[];};prisma.delaySettings.findUnique=async({where})=>{assert.equal(where.tenantId,'a');return null;};prisma.$transaction=async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn(prisma);};
const app=express();app.use('/executive',executiveRouter);app.use((e,req,res,next)=>res.status(500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const call=(query='',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/executive${query}`,{headers:auth?{Authorization:'Bearer '+jwt.sign({sub:'u',tenantId:'a',role:'ADMIN'},process.env.JWT_SECRET)}:{}});
test('Executive API: ruolo attuale, account attivo, tenant e periodo validato prima delle query dati',async()=>{try{
 assert.equal((await call('',false)).status,401);for(role of ['TECNICO','ACCETTATORE','AMMINISTRAZIONE',null])assert.equal((await call()).status,403);assert.equal(reads,0);
 role='ADMIN';assert.equal((await call('?period=PERSONALIZZATO&from=2026-01-01&to=2030-01-01')).status,400);assert.equal(reads,0);
 const response=await call('?period=MESE');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const d=await response.json();assert.equal(d.kpis.length,19);assert.equal(d.kpis.find(k=>k.id==='cash').value,null);assert.equal(d.funnel.length,6);
 }finally{await new Promise(r=>server.close(r));await prisma.$disconnect();}});
