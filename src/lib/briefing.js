import {z} from 'zod';
import {day,addDays,capacity} from './delay.js';
import {isBlocking,partAlerts} from './parts-tracking.js';
import {allocateHours} from './executive.js';

export const briefingDefaults={morningEnabled:true,morningTime:'08:00',eveningEnabled:false,eveningTime:'18:30'};
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const briefingSettingsSchema=z.object({morningEnabled:z.boolean(),morningTime:clock,eveningEnabled:z.boolean(),eveningTime:clock}).strict().refine(s=>s.eveningTime>s.morningTime,'Il riepilogo serale deve seguire quello mattutino');
export function dueBriefings(settings,now=new Date()){
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
 return ['morning','evening'].filter(k=>settings[k+'Enabled']&&time>=settings[k+'Time']);
}
export function buildBriefing(ctx,now=new Date(),kind='live',morning=null){
 const today=day(now),tomorrow=addDays(today,1),{vehicles=[],parts=[],workOrders=[],settings=null,appointments=[]}=ctx;
 const active=vehicles.filter(v=>v.stage!=='CONSEGNATA'&&!v.dataConsegnaEffettiva),byId=new Map(vehicles.map(v=>[v.id,v]));
 const label=v=>`${v.marca} ${v.modello} · ${v.targa}`;
 const reference=v=>({vehicleId:v.id,label:label(v)});
 const actions=[],missing=[];
 const add=(key,v,severity,title,reason,button='VERIFICA')=>actions.push({key,vehicleId:v.id,label:label(v),severity,title,reason,button});
 const due=active.filter(v=>day(v.dataPrevistaConsegna)===today),late=active.filter(v=>v.dataPrevistaConsegna&&day(v.dataPrevistaConsegna)<today);
 const risky=[],unknownRisk=[];
 for(const v of active){
  const f=v.delayForecasts?.[0];
  const fresh=f&&+now-+new Date(f.createdAt)<=30*60000&&+new Date(f.createdAt)<=+now&&day(f.promisedAt)===day(v.dataPrevistaConsegna);
  if(!fresh||f.risk==null)unknownRisk.push(v.id);
  else if(f.risk>60){risky.push(v);add('delay:'+v.id,v,'red','Rivalutare la consegna',`Indice di rischio ${f.risk}% (stima euristica, non probabilità certificata). ${f.result?.factors?.map(x=>typeof x==='string'?x:(x.text||x.message||x.description||x.label||'')).filter(Boolean).join('; ')||'Verificare i fattori nel modulo Predictive Delay AI.'}`,'APRI');}
  if(late.includes(v))add('late:'+v.id,v,'red','Verificare la consegna scaduta',`Data promessa ${day(v.dataPrevistaConsegna)}; la pratica risulta ancora aperta.`,'CONTATTA');
 }
 if(unknownRisk.length)missing.push(`Rischio non disponibile o previsione oltre 30 minuti per ${unknownRisk.length} vetture. Il conteggio dei rischi è parziale.`);
 const blocked=new Set();
 for(const p of parts){const v=byId.get(p.vehicleId);if(!active.includes(v))continue;
  if(isBlocking(p))blocked.add(v.id);
  const alerts=partAlerts(p,now).filter(a=>['NOT_ORDERED','ETA_OVERDUE','UNCHECKED','BLOCKING'].includes(a.code));
  if(alerts.length)add('part:'+p.id,v,isBlocking(p)?'red':'amber',p.status==='ARRIVATO'?'Controllare il ricambio arrivato':'Verificare o sollecitare il ricambio',`${p.data.description} (${p.data.code}): ${alerts.map(a=>a.message.replace('⚠️ ','')).join('; ')}${p.data.eta?'. ETA '+p.data.eta:''}.`);
 }
 let pending=0;
 for(const v of active)for(const q of v.quotes||[])if(['BOZZA','INVIATO'].includes(q.stato)&&Number(q.imponibile)>3000){pending++;add('quote:'+q.id,v,'amber','Verificare il preventivo non approvato',`Preventivo ${q.id}: € ${Number(q.imponibile).toFixed(2)} IVA esclusa; stato ${q.stato}.`,'VERIFICA');}
 const entries=workOrders.flatMap(w=>(w.timeEntries||[]).map(e=>({...e,workOrderId:w.id,vehicleId:w.vehicleId}))),hours=allocateHours(entries,-Infinity,+now,+now);
 for(const w of workOrders){const v=byId.get(w.vehicleId);if(!active.includes(v)||w.stato==='COMPLETATA')continue;
  const actual=hours.get(w.id)?.hours||0,planned=Number(w.oreStimate);
  if(planned>0&&actual>planned)add('hours:'+w.id,v,'amber','Verificare le ore della lavorazione',`${w.titolo}: ${actual.toFixed(1)} ore registrate rispetto a ${planned.toFixed(1)} previste (+${Math.round((actual/planned-1)*100)}%). Timer aperti inclusi; ore simultanee ripartite.`);
 }
 const tomorrowOrders=workOrders.filter(w=>active.some(v=>v.id===w.vehicleId)&&w.stato!=='COMPLETATA'&&w.dataConsegna&&day(w.dataConsegna)<=tomorrow);
 const load=[];
 if(settings?.calendarConfirmed){for(const department of ['carrozzeria','meccanica','verniciatura','finitura']){
  const orders=tomorrowOrders.filter(w=>w.reparto.toLowerCase()===department),remaining=orders.reduce((n,w)=>n+Math.max(0,Number(w.oreStimate)-(hours.get(w.id)?.hours||0)),0);
  const available=capacity(tomorrow,department,{settings,now,appointments,accountedVehicleIds:orders.map(w=>w.vehicleId)}),percent=available>0?Math.round(remaining/available*100):null;
  load.push({department,hours:remaining,capacity:available,percent});
  if(remaining>available&&orders.length)add('capacity:'+department,byId.get(orders[0].vehicleId),'red',`Rivedere il carico di ${department} domani`,`${remaining.toFixed(1)} ore residue su lavori in scadenza entro ${tomorrow}; capacità disponibile ${available.toFixed(1)} ore${percent==null?'':` (${percent}%)`}. È un confronto con le scadenze, non una prenotazione delle ore. Aprire la pratica e verificare le assegnazioni.`,'ASSEGNA');
 }}else missing.push('Capacità di domani non disponibile: confermare calendario e tecnici in Predictive Delay AI.');
 const unscheduled=workOrders.filter(w=>active.some(v=>v.id===w.vehicleId)&&w.stato!=='COMPLETATA'&&!w.dataConsegna).length;
 if(unscheduled)missing.push(`${unscheduled} lavorazioni senza scadenza escluse dal carico di domani.`);
 const completed=workOrders.filter(w=>(w.eventi||[]).some(e=>e.tipo==='TERMINATA'&&day(e.createdAt)===today)&&w.stato==='COMPLETATA').map(w=>({...reference(byId.get(w.vehicleId)),title:w.titolo}));
 const delivered=vehicles.filter(v=>day(v.dataConsegnaEffettiva)===today);
 const morningDue=morning?.metrics?.deliveries?.rows||[],slipped=morningDue.filter(r=>active.some(v=>v.id===r.vehicleId));
 return {version:1,kind,day:today,generatedAt:now.toISOString(),actions:actions.sort((a,b)=>(a.severity==='red'?0:1)-(b.severity==='red'?0:1)),missing,
  metrics:{active:{value:active.length,rows:active.map(reference)},deliveries:{value:due.length,rows:due.map(reference)},risk:{value:risky.length,unknown:unknownRisk.length,rows:risky.map(reference)},blocked:{value:blocked.size,rows:active.filter(v=>blocked.has(v.id)).map(reference)},pending:{value:pending},late:{value:late.length,rows:late.map(reference)}},
  tomorrow:{day:tomorrow,deliveries:active.filter(v=>day(v.dataPrevistaConsegna)===tomorrow).map(reference),load},
  evening:{completed,delivered:delivered.map(reference),openProblems:actions.length,slipped:morning?slipped:null,explanation:'Slittate: vetture attese nel briefing mattutino e ancora aperte al momento del riepilogo. Le date promesse non vengono modificate.'}};
}
