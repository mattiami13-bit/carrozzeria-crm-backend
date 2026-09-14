import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTrackedPart,partDataSchema,partAlerts,isBlocking,blockedDuration,partsProfitData,projectPart,trackingDependencies,validDocument} from '../src/lib/parts-tracking.js';
import {emptyLedger,calculate} from '../src/lib/profit.js';
const make=(data={},status='DA_ORDINARE')=>({id:'p',createdAt:'2026-09-01',status,data:{...emptyTrackedPart(),code:'OEM1',description:'Paraurti',...data}});
test('alert ordinazione, ETA, prezzo, controllo e fermo',()=>{
 const p=make({blocking:true,eta:'2026-09-02',plannedUnitCents:100,actualUnitCents:120});
 assert.deepEqual(partAlerts(p,new Date('2026-09-03')).map(a=>a.code),['NOT_ORDERED','ETA_OVERDUE','OVER_BUDGET','BLOCKING']);
 p.status='ARRIVATO';assert.ok(partAlerts(p).some(a=>a.code==='UNCHECKED'));assert.ok(isBlocking(p));
 p.status='CONTROLLATO';assert.equal(isBlocking(p),false);
 p.data.returnState='SENT';p.data.replacementNeeded=true;assert.ok(isBlocking(p));assert.equal(trackingDependencies([p])[0].eta,null);
 p.data.cancelled=true;assert.deepEqual(partAlerts(p),[]);assert.equal(isBlocking(p),false);
});
test('fermi sovrapposti contati una sola volta e storico chiuso',()=>{
 const r=blockedDuration([{startedAt:'2026-09-01',endedAt:'2026-09-03'},{startedAt:'2026-09-02',endedAt:'2026-09-04'},{startedAt:'2026-09-05',endedAt:null}],new Date('2026-09-06'));
 assert.equal(r.days,4);assert.equal(r.hours,96);assert.equal(r.active,true);
});
test('costi automatici, quantità e reso parziale senza duplicare voce manuale',()=>{
 const ledger=emptyLedger('2026-09-01');ledger.costs=[{id:'manual',category:'ricambi',phase:'actual',quantity:1,unitCents:500,date:'2026-09-01',description:'Originale'}];
 const p=make({quantity:2,plannedUnitCents:1000,actualUnitCents:1200,replaceActualCostId:'manual',returnState:'CREDITED',returnedQty:1,returnDate:'2026-09-02',returnReason:'Errato',creditCents:1000});
 assert.ok(partDataSchema.safeParse(p.data).success);assert.ok(partAlerts(p).some(a=>a.code==='OVER_BUDGET'));
 const a=partsProfitData(ledger,[p]);assert.equal(calculate(a.data).actual,1400);assert.equal(calculate(a.data).planned,2000);assert.equal(ledger.costs.length,1);
 assert.deepEqual(partsProfitData(ledger,[p]),a);
 p.data.actualUnitCents=null;p.data.creditCents=0;const missing=partsProfitData(ledger,[p]);assert.equal(calculate(missing.data).actual,500);assert.ok(missing.actualMissing);
 p.data.actualUnitCents=1200;p.data.cancelled=true;assert.equal(calculate(partsProfitData(ledger,[p]).data).actual,2400);
});
test('rimborsi richiedono conferma, quantità valida e costo conosciuto',()=>{
 const d=make({returnState:'SENT',returnedQty:1,returnDate:'2026-09-01',returnReason:'Errato',creditCents:100,actualUnitCents:100}).data;
 assert.equal(partDataSchema.safeParse(d).success,false);d.returnState='CREDITED';assert.ok(partDataSchema.safeParse(d).success);d.returnedQty=2;assert.equal(partDataSchema.safeParse(d).success,false);
});
test('permessi eliminano prezzi, rimborso, documenti e snapshot',()=>{
 const p={...make({actualUnitCents:12345}),documents:[{name:'Riservato'}],events:[{id:'e',snapshot:{secret:12345},reason:'Controllato'}]};
 const publicPart=projectPart(p,false);assert.equal(publicPart.data.actualUnitCents,undefined);assert.deepEqual(publicPart.documents,[]);assert.equal(publicPart.events[0].snapshot,undefined);
 assert.ok(validDocument(Buffer.from('%PDF-1.7'),'application/pdf'));assert.equal(validDocument(Buffer.from('<script>'),'application/pdf'),false);
});
