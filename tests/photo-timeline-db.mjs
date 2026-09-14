import 'dotenv/config';
import assert from 'node:assert/strict';
import {prisma} from '../src/lib/prisma.js';
const rollback=new Error('ROLLBACK_PHOTO_TEST');
try{await prisma.$transaction(async tx=>{
 const t=await tx.tenant.create({data:{ragioneSociale:'Test transitorio timeline'}}),c=await tx.client.create({data:{tenantId:t.id,nome:'Test',cognome:'Foto'}}),v=await tx.vehicle.create({data:{tenantId:t.id,clientId:c.id,marca:'TEST',modello:'TEST',targa:'TEST-PHOTO'}});
 const p=await tx.photo.create({data:{vehicleId:v.id,fase:'PRIMA',url:'https://example.test/original.jpg'}});assert.deepEqual(p.timeline,{});assert.equal(p.timelineVersion,1);
 await tx.photo.update({where:{id:p.id},data:{timeline:{category:'DANNI_NASCOSTI',notes:'Test'},fase:'DURANTE',timelineVersion:{increment:1}}});
 await tx.photoTimelineEdit.create({data:{photoId:p.id,actorId:'test',before:{},after:{category:'DANNI_NASCOSTI'}}});
 assert.equal((await tx.photo.updateMany({where:{id:p.id,timelineVersion:1},data:{timeline:{}}})).count,0);
 const saved=await tx.photo.findUnique({where:{id:p.id},include:{timelineEdits:true}});assert.equal(saved.url,p.url);assert.equal(saved.timelineEdits.length,1);
 await tx.photo.delete({where:{id:p.id}});assert.equal(await tx.photoTimelineEdit.count({where:{photoId:p.id}}),0);
 throw rollback;
},{timeout:20000});}catch(e){if(e!==rollback)throw e;console.log('Database: foto storiche compatibili, correzioni, conflitti e cancellazione verificati; test annullato integralmente.');}finally{await prisma.$disconnect();}
