import {z} from "zod";
export const MODEL_VERSION="delay-explainable-v1";
export const DEPARTMENTS=["carrozzeria","meccanica","verniciatura","finitura"];
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,"Data non valida");
const hours=z.number().min(0).max(10000);
export const planSchema=z.object({
 source:z.enum(["manual","profit"]),
 hours:z.array(z.object({department:z.enum(DEPARTMENTS),planned:hours.nullable(),completed:hours.nullable()}).strict()).length(4),
 dependenciesReviewed:z.boolean(),
 dependencies:z.array(z.object({id:z.string().min(1).max(100),kind:z.enum(["part","external"]),description:z.string().min(1).max(200),orderItemId:z.string().max(100).nullable(),done:z.boolean(),eta:dateSchema.nullable()}).strict()).max(100)
}).strict().refine(p=>new Set(p.hours.map(h=>h.department)).size===4&&new Set(p.dependencies.map(d=>d.id)).size===p.dependencies.length,"Voci duplicate");
export const settingsSchema=z.object({
 calendarConfirmed:z.boolean(),workWeek:z.array(z.number().int().min(0).max(6)).min(1).max(7),startHour:z.number().int().min(0).max(16),hoursPerDay:z.number().min(1).max(8),
 closures:z.array(z.object({from:dateSchema,to:dateSchema,label:z.string().min(1).max(100)}).strict().refine(c=>c.to>=c.from)).max(200),
 technicians:z.array(z.object({userId:z.string().min(1).max(100),department:z.enum(DEPARTMENTS),hoursPerDay:z.number().min(0.5).max(8),unavailableDates:z.array(dateSchema).max(366)}).strict()).max(100)
}).strict().refine(s=>new Set(s.workWeek).size===s.workWeek.length&&new Set(s.technicians.map(t=>t.userId)).size===s.technicians.length,"Giorni o tecnici duplicati");
export const defaultSettings=()=>({calendarConfirmed:false,workWeek:[1,2,3,4,5],startHour:8,hoursPerDay:8,closures:[],technicians:[]});
export const emptyPlan=()=>({source:"manual",hours:DEPARTMENTS.map(department=>({department,planned:null,completed:null})),dependenciesReviewed:false,dependencies:[]});
export function day(value){return value?new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Rome"}).format(new Date(value)):null;}
export function addDays(d,n){const v=new Date(d+"T12:00:00Z");v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10);}
const daysBetween=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);
function wallHours(value){const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Rome",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));return Number(p.find(x=>x.type==="hour").value)+Number(p.find(x=>x.type==="minute").value)/60;}
export function openDay(d,s){return s.workWeek.includes(new Date(d+"T12:00Z").getUTCDay())&&!s.closures.some(c=>c.from<=d&&c.to>=d);}
function nextOpen(d,s){for(let i=0;i<370;i++,d=addDays(d,1))if(openDay(d,s))return d;return null;}
function unionHours(intervals){let sum=0,end=-Infinity;for(const [a,b] of intervals.sort((x,y)=>x[0]-y[0])){sum+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return sum;}
export function capacity(d,department,context){
 const {settings:s,now,appointments=[],accountedVehicleIds=[]}=context;
 if(!s.calendarConfirmed||!openDay(d,s))return 0;
 const start=Math.max(s.startHour,d===day(now)?wallHours(now):s.startHour);
 return s.technicians.filter(t=>t.department===department&&!t.unavailableDates.includes(d)).reduce((total,t)=>{
  const end=s.startHour+Math.min(t.hoursPerDay,s.hoursPerDay);
  const busy=appointments.filter(a=>a.tecnicoId===t.userId&&!accountedVehicleIds.includes(a.vehicleId)&&day(a.inizio)<=d&&day(a.fine)>=d).map(a=>[Math.max(start,day(a.inizio)<d?0:wallHours(a.inizio)),Math.min(end,day(a.fine)>d?24:wallHours(a.fine))]).filter(([a,b])=>b>a);
  return total+Math.max(0,end-start-unionHours(busy));
 },0);
}
export function operationalHours(plan,profit){
 if(plan.source!=="profit")return {rows:plan.hours,source:"Ore pianificate/completate inserite nella pratica"};
 if(!profit)return {rows:emptyPlan().hours,source:"Profit Tracker non compilato"};
 const map={carrozzeria:"carrozziere",meccanica:"meccanico",verniciatura:"verniciatore"};
 return {rows:DEPARTMENTS.map(department=>{
  const category=map[department];
  if(!category)return plan.hours.find(h=>h.department===department);
  const sum=phase=>profit.costs.filter(c=>c.category===category&&c.phase===phase).reduce((a,c)=>a+c.quantity,0);
  const recorded=profit.costs.some(c=>c.category===category&&c.phase==="actual");
  return {department,planned:profit.plannedComplete?sum("planned"):null,completed:recorded||profit.actualComplete?sum("actual"):null};
 }),source:"Ore dal Profit Tracker; finitura manuale. Nessun importo economico utilizzato"};
}
export function resolveDependencies(plan,items){return plan.dependencies.map(d=>{
 if(!d.orderItemId)return {...d,source:"Inserimento operatore"};
 const item=items.find(i=>i.id===d.orderItemId);
 if(!item)return {...d,done:false,eta:null,source:"Voce ordine non più disponibile"};
 return {...d,description:item.descrizione,done:item.quantitaRicevuta>=item.quantitaOrdinata,eta:day(item.supplierOrder.dataConsegnaPrevista),source:"Ordine fornitore collegato"};
});}
export function predict(input){
 const {vehicle:v,settings:s,now,hours:rows,dependencies,depsReviewed,history=[],queue={},appointments=[],unknownWorkload=0}=input;
 const today=day(now),promised=day(v.dataPrevistaConsegna),factors=[],missing=[];
 const add=(code,text,points=0)=>factors.push({code,text,points});
 const known=rows.every(h=>h.planned!==null&&h.completed!==null);
 const remaining=known?rows.reduce((a,h)=>a+Math.max(0,h.planned-h.completed),0):null;
 add("workflow",`Stato: ${v.stage.toLowerCase().replaceAll("_"," ")}; ingresso: ${day(v.dataIngresso)}`);
 if(remaining!==null)add("hours",`Rimangono ${remaining.toLocaleString("it-IT",{maximumFractionDigits:2})} ore di lavoro registrato`);else missing.push("Ore previste e completate di tutti i reparti");
 if(!s.calendarConfirmed)missing.push("Calendario lavorativo, festività e chiusure da confermare");
 if(!depsReviewed)missing.push("Verifica ricambi e lavorazioni esterne");
 if(unknownWorkload)missing.push(`${unknownWorkload} altre pratiche senza ore complete: carico reparto parziale`);
 const active=dependencies.filter(d=>!d.done),unknownEta=active.some(d=>!d.eta||d.eta<today);
 let anchor=today;
 for(const dep of active){add("dependency",`${dep.description}: ${dep.kind==="external"?"lavorazione esterna in attesa":"ricambio mancante"}; ${dep.eta?"ETA "+dep.eta:"ETA sconosciuta"}`);if(dep.eta&&dep.eta>=today&&dep.eta>anchor)anchor=dep.eta;else if(!dep.eta||dep.eta<today)missing.push(`ETA aggiornata: ${dep.description}`);}
 if(v.stage==="ORDINE_RICAMBI"&&!active.length&&!depsReviewed)missing.push("Workflow in attesa ricambi, nessuna dipendenza verificata");
 if(v.stage==="ATTESA_APPROVAZIONE")missing.push("Approvazione preventivo ancora in attesa");
 let estimated=null,cursor=anchor,used=0,capacityKnown=true;
 const context={settings:s,now,appointments,accountedVehicleIds:input.accountedVehicleIds??[]};
 let highestLoad=0;
 if(v.tecnicoId){const assigned=s.technicians.find(t=>t.userId===v.tecnicoId);if(!assigned)missing.push("Disponibilità del tecnico assegnato non configurata");else if(assigned.unavailableDates.includes(today))add("assigned","Il tecnico assegnato è assente oggi");}
 for(const h of rows){
  if(h.planned===null||h.completed===null)continue;
  const own=Math.max(0,h.planned-h.completed);if(!own)continue;
  if(!s.calendarConfirmed){capacityKnown=false;continue;}
  const assigned=s.technicians.find(t=>t.userId===v.tecnicoId&&t.department===h.department);
  const departmentContext=assigned?{...context,settings:{...s,technicians:s.technicians.filter(t=>t.department!==h.department||t.userId===v.tecnicoId)}}:context;
  const staff=departmentContext.settings.technicians.filter(t=>t.department===h.department);
  if(!staff.length){missing.push(`Tecnici/capacità del reparto ${h.department}`);capacityKnown=false;continue;}
  let fiveDayCapacity=0,open=0;
  for(let i=0;i<370&&open<5;i++){const d=addDays(today,i);if(openDay(d,s)){open++;fiveDayCapacity+=capacity(d,h.department,departmentContext);}}
  const totalLoad=Number(queue[h.department]??0)+own;
  const load=fiveDayCapacity>0?Math.round(totalLoad/fiveDayCapacity*100):null;
  highestLoad=Math.max(highestLoad,load??0);
  add("load",`${h.department}: ${load===null?"capacità disponibile nulla":load+"% della capacità dei prossimi 5 giorni aperti"}; ${Number(queue[h.department]??0).toFixed(1)} ore in coda prima della pratica; ${staff.length} tecnici configurati`);
  let pending=totalLoad,finished=false;
  for(let i=0;i<370;i++){
   if(!cursor)break;
   const available=Math.min(Math.max(0,s.hoursPerDay-used),capacity(cursor,h.department,departmentContext));
   if(available>0){const done=Math.min(pending,available);pending-=done;used+=done;if(pending<0.001){finished=true;break;}}
   cursor=addDays(cursor,1);used=0;
  }
  if(!finished){capacityKnown=false;missing.push(`Capacità ${h.department} insufficiente nell’orizzonte di un anno`);}
 }
 if(known&&capacityKnown&&s.calendarConfirmed)estimated=remaining===0?nextOpen(anchor,s):cursor;
 const entered=v.stageEnteredAt??v.dataIngresso;
 const elapsed=Math.max(0,(new Date(now)-new Date(entered))/86400000);
 const samples=history.filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
 if(samples.length>=5){
  const median=samples[Math.floor(samples.length/2)],residual=Math.max(0,median-elapsed);
  const historical=addDays(today,Math.ceil(residual));
  add("history",`${samples.length} riparazioni concluse dallo stesso stato: mediana ${median.toFixed(1)} giorni; permanenza attuale ${elapsed.toFixed(1)} giorni`);
  if(!estimated&&s.calendarConfirmed)estimated=nextOpen(historical>anchor?historical:anchor,s);
 }else missing.push(`Storico stesso stato insufficiente (${samples.length}/5 riparazioni concluse)`);
 if(!s.calendarConfirmed||unknownEta||v.stage==="ATTESA_APPROVAZIONE")estimated=null;
 if(s.closures.length)add("closures",`Calendario configurato con ${s.closures.length} periodi di chiusura/festività, esclusi dal calcolo`);
 let risk=null;
 if(!promised)missing.push("Data di consegna promessa al cliente");
 else if(promised<today){risk=100;add("overdue","Data promessa già superata: ritardo osservato, non una previsione",100);}
 else if(estimated){
  const delta=daysBetween(promised,estimated);
  let base=Math.round(50+45*Math.tanh(delta/2));
  add("schedule",`Previsione ${estimated} rispetto alla promessa ${promised}: ${delta} giorni di scostamento`,base);
  let extra=0;
  if(samples.length>=5&&elapsed>samples[Math.floor(samples.length/2)]){extra+=8;add("stage_age","Permanenza nello stato superiore alla mediana storica",8);}
  if(highestLoad>90){extra+=8;add("pressure","Carico noto oltre il 90% della capacità",8);}
  if(missing.length){extra+=Math.min(10,missing.length*2);add("uncertainty","Dati incompleti: prudenza aggiuntiva sull’indice",Math.min(10,missing.length*2));}
  risk=Math.max(0,Math.min(99,base+extra));
 }
 if(risk===null)add("unavailable","Dati insufficienti per assegnare un rischio numerico attendibile");
 return {risk,band:risk===null?"unknown":risk<=30?"green":risk<=60?"orange":"red",estimatedDate:estimated,promisedDate:promised,remainingHours:remaining,factors,missing:[...new Set(missing)],historyCount:samples.length,
  modelVersion:MODEL_VERSION,confidence:missing.length?"parziale":"completa",method:"Indice indicativo 0–100%, non una probabilità già validata sulle consegne reali. La data stimata non cambia la promessa al cliente.",computedAt:new Date(now).toISOString()};
}
export function accuracy(forecasts){
 const initial=new Map();
 for(const f of [...forecasts].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))){
  if(f.risk===null||!f.promisedAt||day(f.createdAt)>day(f.promisedAt)||!f.actualDeliveredAt||new Date(f.createdAt)>=new Date(f.actualDeliveredAt))continue;
  if(!initial.has(f.vehicleId))initial.set(f.vehicleId,f);
 }
 const bins=[{label:"0–30%",count:0,late:0},{label:"31–60%",count:0,late:0},{label:"61–100%",count:0,late:0}];let correct=0,totalError=0,dated=0;
 for(const f of initial.values()){
  const late=day(f.actualDeliveredAt)>day(f.promisedAt),bin=f.risk<=30?0:f.risk<=60?1:2;bins[bin].count++;bins[bin].late+=Number(late);correct+=Number((f.risk>60)===late);
  if(f.estimatedDate){dated++;totalError+=Math.abs(daysBetween(f.estimatedDate,day(f.actualDeliveredAt)));}
 }
 return {sampleSize:initial.size,classificationAccuracy:initial.size?correct/initial.size*100:null,meanAbsoluteDaysError:dated?totalError/dated:null,dateSampleSize:dated,bins:bins.map(b=>({...b,observedLatePercent:b.count?b.late/b.count*100:null})),definition:"Prima previsione numerica per vettura prima della consegna e non oltre il giorno promesso. Rosso (>60) = previsione di ritardo. Esclusi giudizi retrospettivi. Campione osservazionale, non validazione indipendente."};
}
