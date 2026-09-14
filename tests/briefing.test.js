import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBriefing,dueBriefings,briefingDefaults,briefingSettingsSchema} from '../src/lib/briefing.js';
import {emptyTrackedPart} from '../src/lib/parts-tracking.js';
const now=new Date('2026-09-14T10:00:00Z');
const vehicle=(id='v')=>({id,marca:'BMW',modello:'X5',targa:id,stage:'IN_LAVORAZIONE',dataPrevistaConsegna:new Date('2026-09-14T12:00Z'),quotes:[]});
test('Nessun dato inventato: vuoto e calendario mancante',()=>{const b=buildBriefing({},now);assert.equal(b.actions.length,0);assert.equal(b.metrics.active.value,0);assert.equal(b.tomorrow.load.length,0);assert.equal(b.evening.slipped,null);assert.ok(b.missing.length);});
test('Rischi: solo previsioni recenti con stessa promessa, soglia stretta >60',()=>{
 const vehicles=[61,60,null,90,80].map((risk,i)=>({...vehicle(String(i)),delayForecasts:[{risk,createdAt:new Date(i===3?+now-31*60000:+now),promisedAt:new Date(i===4?'2026-09-15T12:00Z':'2026-09-14T12:00Z'),result:{factors:['Ricambio in attesa']}}]}));
 const b=buildBriefing({vehicles},now);assert.equal(b.metrics.risk.value,1);assert.equal(b.metrics.risk.unknown,3);assert.match(b.actions[0].reason,/Ricambio in attesa/);
});
test('Ricambi bloccanti contano le vetture una sola volta, escludono cancellati e consegnati',()=>{
 const vehicles=[vehicle(),{...vehicle('done'),stage:'CONSEGNATA',dataConsegnaEffettiva:now}];
 const part=(id,vehicleId='v')=>({id,vehicleId,status:'DA_ORDINARE',data:{...emptyTrackedPart(),code:id,description:'Paraurti',blocking:true}});
 const b=buildBriefing({vehicles,parts:[part('p'),part('p2'),part('d','done'),{...part('c'),data:{...part('c').data,cancelled:true}}]},now);
 assert.equal(b.metrics.blocked.value,1);assert.equal(b.actions.length,2);assert.equal(b.evening.delivered.length,1);
});
test('Preventivi strettamente oltre 3000 imponibili, solo bozze o inviati',()=>{const v=vehicle();v.quotes=[{id:'1',stato:'INVIATO',imponibile:'3000.01'},{id:'2',stato:'BOZZA',imponibile:3000},{id:'3',stato:'ACCETTATO',imponibile:8000}];const b=buildBriefing({vehicles:[v]},now);assert.equal(b.metrics.pending.value,1);assert.equal(b.actions[0].key,'quote:1');});
test('Ore simultanee non duplicate e nessuna mutazione delle date promesse',()=>{
 const v=vehicle(),orders=['a','b'].map(id=>({id,vehicleId:'v',titolo:id,stato:'IN_CORSO',oreStimate:0.5,timeEntries:[{tecnicoId:'t',inizio:'2026-09-14T08:00Z',fine:null}]}));
 const before=JSON.stringify(v),b=buildBriefing({vehicles:[v],workOrders:orders},now);
 assert.equal(b.actions.length,2);assert.match(b.actions[0].reason,/1.0 ore/);assert.equal(JSON.stringify(v),before);
});
test('Capacità domani rispetta chiusure e non attribuisce lavori senza scadenza',()=>{
 const v=vehicle(),workOrders=[{id:'w',vehicleId:v.id,titolo:'Verniciatura',stato:'DA_INIZIARE',reparto:'VERNICIATURA',oreStimate:9,dataConsegna:'2026-09-15T12:00Z'},{id:'x',vehicleId:v.id,stato:'DA_INIZIARE',reparto:'VERNICIATURA',oreStimate:20}];
 const settings={calendarConfirmed:true,workWeek:[1,2,3,4,5],startHour:8,hoursPerDay:8,closures:[],technicians:[{userId:'t',department:'verniciatura',hoursPerDay:8,unavailableDates:[]}]};
 let b=buildBriefing({vehicles:[v],workOrders,settings},now);assert.equal(b.tomorrow.load.find(l=>l.department==='verniciatura').percent,113);assert.ok(b.missing.some(m=>m.includes('1 lavorazioni')));
 settings.closures=[{from:'2026-09-15',to:'2026-09-15'}];b=buildBriefing({vehicles:[v],workOrders,settings},now);assert.equal(b.tomorrow.load.find(l=>l.department==='verniciatura').capacity,0);assert.ok(b.actions.some(a=>a.key==='capacity:verniciatura'));
});
test('Riepilogo confronta le consegne iniziali anche dopo modifica della promessa',()=>{
 const v=vehicle(),morning=buildBriefing({vehicles:[v]},now,'morning');v.dataPrevistaConsegna='2026-09-16T12:00Z';let b=buildBriefing({vehicles:[v]},now,'evening',morning);assert.equal(b.evening.slipped.length,1);
 v.stage='CONSEGNATA';v.dataConsegnaEffettiva=now;b=buildBriefing({vehicles:[v]},now,'evening',morning);assert.equal(b.evening.slipped.length,0);assert.equal(b.evening.delivered.length,1);
});
test('Orari Europe/Rome anche al cambio ora, sera opt-in e validazione',()=>{
 assert.deepEqual(dueBriefings(briefingDefaults,new Date('2026-09-14T05:59Z')),[]);
 assert.deepEqual(dueBriefings(briefingDefaults,new Date('2026-09-14T06:00Z')),['morning']);
 assert.deepEqual(dueBriefings({...briefingDefaults,eveningEnabled:true},new Date('2026-10-25T17:30Z')),['morning','evening']);
 assert.equal(briefingSettingsSchema.safeParse({...briefingDefaults,morningTime:'25:00'}).success,false);
 assert.equal(briefingSettingsSchema.safeParse({...briefingDefaults,eveningTime:'07:00'}).success,false);
});
