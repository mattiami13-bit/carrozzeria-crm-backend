import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
process.env.SUPABASE_URL='https://store.example';process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-photo-test';
const {prisma}=await import('../src/lib/prisma.js');const {suggestPhotoCategory,savePhotoSuggestion,normalizePhoto}=await import('../src/lib/photo-timeline-service.js');
let used=0,current={id:'p',vehicleId:'v',timelineVersion:1,timeline:{category:null,authorName:'Autore'}};
prisma.$queryRaw=async()=>[{id:'t'}];prisma.tenant.findUnique=async()=>({piano:'TRIAL',limiteAnalisiIAMensile:2});prisma.aiAnalysisLog.count=async()=>used;prisma.aiAnalysisLog.create=async()=>({id:String(++used)});prisma.$transaction=async fn=>fn(prisma);
prisma.photo.updateMany=async({where,data})=>{if(where.timelineVersion!==current.timelineVersion)return{count:0};current={...current,timeline:data.timeline,timelineVersion:current.timelineVersion+1};return{count:1};};prisma.photo.findFirst=async()=>current;prisma.photo.update=async({data})=>current={...current,timeline:data.timeline,timelineVersion:current.timelineVersion+1};
test('servizio AI: nessuna invenzione senza chiave, quota, immagine orientata e correzioni preservate',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.ANTHROPIC_API_KEY;
 try{const raw=await sharp({create:{width:120,height:80,channels:3,background:'#ffffff'}}).jpeg().withMetadata({orientation:6}).toBuffer();const normalized=await normalizePhoto(raw),m=await sharp(normalized).metadata();assert.equal(m.width,80);assert.equal(m.height,120);
 delete process.env.ANTHROPIC_API_KEY;assert.equal((await suggestPhotoCategory(current,'t',raw)).status,'unavailable');assert.equal(used,0);
 process.env.ANTHROPIC_API_KEY='FAKE_TEST_KEY';globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(JSON.parse(options.body).messages[0].content[0].source.media_type,'image/jpeg');current.timeline.category='DANNI_NASCOSTI';current.timelineVersion++;return {ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({category:'SMONTAGGIO',confidence:85,reason:'Area smontata'})}]})};};
 const result=await savePhotoSuggestion(current,'t',raw);assert.equal(result.timeline.category,'DANNI_NASCOSTI');assert.equal(result.timeline.ai.category,'SMONTAGGIO');assert.equal(result.timeline.authorName,'Autore');assert.equal(used,1);
 used=2;assert.equal((await suggestPhotoCategory(current,'t',raw)).status,'unavailable');
 }finally{globalThis.fetch=originalFetch;if(key)process.env.ANTHROPIC_API_KEY=key;else delete process.env.ANTHROPIC_API_KEY;await prisma.$disconnect();}
});
