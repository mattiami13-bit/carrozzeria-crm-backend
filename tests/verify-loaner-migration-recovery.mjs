// Read-only verification of every statement in the formerly interrupted migration.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prisma} from '../src/lib/prisma.js';
const sql=readFileSync('prisma/migrations/20260914220000_auto_sostitutive/migration.sql','utf8');
try{
 const columns=await prisma.$queryRaw`SELECT table_name,column_name,is_nullable,column_default,udt_name,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'loaner_%'`;
 const enums=await prisma.$queryRaw`SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid ORDER BY e.enumsortorder`;
 const indexes=await prisma.$queryRaw`SELECT indexname,tablename,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'loaner_%'`;
 const constraints=await prisma.$queryRaw`SELECT c.conname,t.relname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname LIKE 'loaner_%'`;
 const tables=await prisma.$queryRaw`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('loaner_car_photos','loaner_booking_photos')`;
 let checks=0;
 const col=(table,name,definition)=>{
  const actual=columns.find(c=>c.table_name===table&&c.column_name===name);assert.ok(actual,table+'.'+name);
  const type=definition.match(/^("[^"]+"|\w+(?:\(\d+\))?)/)[1],expected={TEXT:'text',INTEGER:'int4',BYTEA:'bytea','TIMESTAMP(3)':'timestamp'}[type]||type.replaceAll('"','');
  assert.equal(actual.udt_name,expected);if(type==='TIMESTAMP(3)')assert.equal(actual.datetime_precision,3);
  if(/NOT NULL|PRIMARY KEY/.test(definition))assert.equal(actual.is_nullable,'NO');
  if(definition.includes('DEFAULT CURRENT_TIMESTAMP'))assert.equal(actual.column_default,'CURRENT_TIMESTAMP');
  if(definition.includes("DEFAULT 'BENZINA'"))assert.equal(actual.column_default,"'BENZINA'::\"LoanerFuelType\"");
  const ref=definition.match(/REFERENCES "([^"]+)"\("([^"]+)"\)/);
  if(ref)assert.ok(constraints.some(c=>c.relname===table&&c.definition===`FOREIGN KEY ("${name}") REFERENCES ${ref[1]}(${ref[2]})`),`FK ${table}.${name}`);
  checks++;
 };
 for(const m of sql.matchAll(/CREATE TYPE "([^"]+)" AS ENUM \(([^;]+)\);/g)){assert.deepEqual(enums.filter(e=>e.typname===m[1]).map(e=>e.enumlabel),[...m[2].matchAll(/'([^']+)'/g)].map(x=>x[1]));checks++;}
 for(const m of sql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)" ([^;]+);/g))col(m[1],m[2],m[3]);
 for(const m of sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)){
  for(const line of m[2].trim().split('\n')){const c=line.trim().replace(/,$/,'').match(/^"([^"]+)" (.+)$/);assert.ok(c);col(m[1],c[1],c[2]);}
  assert.ok(constraints.some(c=>c.relname===m[1]&&c.definition==='PRIMARY KEY (id)'));checks++;
 }
 for(const m of sql.matchAll(/ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET NOT NULL;/g)){assert.equal(columns.find(c=>c.table_name===m[1]&&c.column_name===m[2]).is_nullable,'NO');checks++;}
 for(const m of sql.matchAll(/ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET DEFAULT ([^;]+);/g)){const c=columns.find(c=>c.table_name===m[1]&&c.column_name===m[2]);assert.ok(c.column_default.startsWith(m[3]));checks++;}
 for(const m of sql.matchAll(/CREATE INDEX "([^"]+)" ON "([^"]+)"\("([^"]+)"\);/g)){assert.ok(indexes.some(i=>i.indexname===m[1]&&i.tablename===m[2]&&i.indexdef.includes(`("${m[3]}")`)));checks++;}
 for(const m of sql.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)"\("([^"]+)"\);/g)){assert.ok(constraints.some(c=>c.conname===m[1]&&c.definition===`FOREIGN KEY ("${m[2]}") REFERENCES ${m[3]}(${m[4]})`));checks++;}
 for(const m of sql.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g)){assert.equal(tables.find(t=>t.relname===m[1])?.relrowsecurity,true);checks++;}
 const mismatches=await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM loaner_bookings b LEFT JOIN loaner_cars lc ON lc.id=b."loanerCarId" WHERE b."tenantId" IS DISTINCT FROM lc."tenantId" OR b."dataInizioPrevista" IS DISTINCT FROM b."dataInizio" OR b."dataConsegna" IS DISTINCT FROM b."dataInizio" OR b."dataRestituzione" IS DISTINCT FROM b."dataFine" OR b."stato"::text IS DISTINCT FROM CASE WHEN b."dataFine" IS NULL THEN 'ASSEGNATA' ELSE 'RESTITUITA' END OR b."createdAt" IS DISTINCT FROM b."dataInizio" OR b."updatedAt" IS DISTINCT FROM COALESCE(b."dataFine",b."dataInizio")`;
 assert.equal(mismatches[0].n,0);checks++;
 console.log(`${checks} controlli superati: tutti i tipi, colonne, vincoli, indici, default, RLS e backfill della migrazione auto sostitutive corrispondono al database. Nessuna scrittura eseguita.`);
}finally{await prisma.$disconnect();}
