import {z} from 'zod';
import {day,addDays,dateSchema,openDay} from './delay.js';
import {calculate,emptyLedger} from './profit.js';
import {partsProfitData} from './parts-tracking.js';
export const executiveQuery=z.object({period:z.enum(['OGGI','SETTIMANA','MESE','TRIMESTRE','ANNO','PERSONALIZZATO']).default('MESE'),from:dateSchema.optional(),to:dateSchema.optional()}).strict();
export function romeTime(d,hour=0){const [y,m,a]=d.split('-').map(Number),target=Date.UTC(y,m-1,a,hour);let stamp=target;for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(new Date(stamp));const v=k=>Number(parts.find(p=>p.type===k).value);stamp+=target-Date.UTC(v('year'),v('month')-1,v('day'),v('hour'),v('minute'),v('second'));}return stamp;}
const dayCount=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
export function executivePeriod(query,now=new Date()){
 const q=executiveQuery.parse(query),today=day(now);let from=today,to=today;
 if(q.period==='SETTIMANA')from=addDays(today,-((new Date(today+'T12:00Z').getUTCDay()+6)%7));
 if(q.period==='MESE')from=today.slice(0,8)+'01';if(q.period==='TRIMESTRE')from=today.slice(0,5)+String(Math.floor((Number(today.slice(5,7))-1)/3)*3+1).padStart(2,'0')+'-01';if(q.period==='ANNO')from=today.slice(0,4)+'-01-01';
 if(q.period==='PERSONALIZZATO'){if(!q.from||!q.to||q.from>q.to||q.to>today||dayCount(q.from,q.to)>366)throw new Error('Scegli un periodo passato o corrente, massimo 366 giorni.');from=q.from;to=q.to;}
 const days=dayCount(from,to),previousTo=addDays(from,-1),previousFrom=addDays(from,-days),end=Math.min(romeTime(addDays(to,1)),+now);
 // Current partial day is compared to the same local time of the last previous day.
 const endOffset=to===today?end-romeTime(today):null,previousEnd=endOffset===null?romeTime(from):romeTime(previousTo)+endOffset;
 return {from,to,start:romeTime(from),end,previous:{from:previousFrom,to:previousTo,start:romeTime(previousFrom),end:previousEnd},label:'Confronto con intervallo precedente di pari giorni; il giorno corrente è confrontato alla stessa ora circa.',now:+now};
}
export function allocateHours(entries,start,end,now=Date.now()){
 const groups=new Map(),result=new Map();
 for(const e of entries){const a=Math.max(+new Date(e.inizio),start),b=Math.min(e.fine?+new Date(e.fine):now,end,now);if(!(b>a))continue;const key=e.tecnicoId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({a,b,id:e.workOrderId,vehicleId:e.vehicleId});}
 for(const rows of groups.values()){
  const events=rows.flatMap(r=>[{at:r.a,delta:1,r},{at:r.b,delta:-1,r}]).sort((a,b)=>a.at-b.at),active=new Map();let previous=events[0]?.at;
  for(let i=0;i<events.length;){const at=events[i].at;if(at>previous&&active.size)for(const {r} of active.values())result.set(r.id,{vehicleId:r.vehicleId,hours:(result.get(r.id)?.hours||0)+(at-previous)/3600000/active.size});
   while(i<events.length&&events[i].at===at){const {r,delta}=events[i++],count=(active.get(r.id)?.count||0)+delta;if(count>0)active.set(r.id,{r,count});else active.delete(r.id);}previous=at;
  }
 }
 return result;
}
const rangeHas=(date,r)=>date!=null&&+new Date(date)>=r.start&&+new Date(date)<r.end;
const sum=rows=>rows.reduce((n,r)=>n+r.value,0);
const ref=(v,value=1,detail='')=>({vehicleId:v.id,label:`${v.marca} ${v.modello} · ${v.targa}`,value,detail});
function stateAt(v,r,now){if(+new Date(v.dataIngresso)>=r.end)return null;const event=(v.stageHistory||[]).filter(h=>+new Date(h.changedAt)<r.end).sort((a,b)=>+new Date(b.changedAt)-+new Date(a.changedAt))[0];if(r.end>=now)return v.stage;if(event)return event.toStage;if(v.dataConsegnaEffettiva&&+new Date(v.dataConsegnaEffettiva)<r.end)return 'CONSEGNATA';return null;}
function deliveredAt(v){return v.dataConsegnaEffettiva||(v.stageHistory||[]).filter(h=>h.toStage==='CONSEGNATA').sort((a,b)=>+new Date(b.changedAt)-+new Date(a.changedAt))[0]?.changedAt;}
function recordValue(v,profits,parts){const record=profits.find(p=>p.vehicleId===v.id);if(record)return calculate(partsProfitData(record.data,parts.filter(p=>p.vehicleId===v.id)).data,v.quotes||[]);
 const accepted=(v.quotes||[]).filter(q=>q.stato==='ACCETTATO');if(accepted.length!==1)return {revenue:null,provisional:true};return {revenue:Math.round(Number(accepted[0].imponibile)*100),provisional:true};}
export function executiveMetrics(ctx,r,now){
 const {vehicles,profits,parts,workOrders,settings}=ctx,byId=new Map(vehicles.map(v=>[v.id,v])),allEntries=workOrders.flatMap(w=>(w.timeEntries||[]).map(e=>({...e,workOrderId:w.id,vehicleId:w.vehicleId}))),kpis=[];
 const metric=(id,label,unit,rows,note,value=sum(rows),partial=0)=>{const m={id,label,unit,value,rows,note,partial};kpis.push(m);return m;};
 const unavailable=(id,label,unit,note)=>metric(id,label,unit,[],note,null);
 unavailable('revenue','Fatturato','money','Manca un registro di fatture emesse. Preventivi accettati e ricavi previsti non sono fatturato.');
 const financial=profits.filter(p=>p.data.date>=r.from&&p.data.date<=r.to&&byId.has(p.vehicleId)).map(p=>({v:byId.get(p.vehicleId),m:calculate(partsProfitData(p.data,parts.filter(x=>x.vehicleId===p.vehicleId)).data,byId.get(p.vehicleId).quotes||[])}));
 const known=financial.filter(x=>x.m.actualMargin!=null),missing=financial.length-known.length,revenue=known.reduce((n,x)=>n+x.m.revenue,0),margin=known.reduce((n,x)=>n+x.m.actualMargin,0),marginRows=known.map(x=>ref(x.v,x.m.actualMargin,`Ricavo previsto ${(x.m.revenue/100).toFixed(2)} €; costi registrati ${(x.m.actual/100).toFixed(2)} €${x.m.provisional?' · dati incompleti':''}`));
 const financialNote=`Profit Tracker per data di competenza: ricavo previsto meno costi reali registrati, IVA esclusa; non utile netto. ${missing} pratiche con ricavi mancanti; ${financial.filter(x=>x.m.provisional).length} registri incompleti.`;
 metric('margin','Margine operativo','money',marginRows,financialNote,known.length?margin:null,missing+known.filter(x=>x.m.provisional).length);
 metric('marginPercent','Margine %','percent',marginRows,financialNote+' Percentuale ponderata sui ricavi, non media delle percentuali.',known.length&&revenue>0?margin/revenue*100:null,missing+known.filter(x=>x.m.provisional).length);
 const arrived=vehicles.filter(v=>rangeHas(v.dataIngresso,r)),delivered=vehicles.filter(v=>rangeHas(deliveredAt(v),r));
 metric('arrived','Vetture entrate','count',arrived.map(v=>ref(v,1,`Ingresso ${day(v.dataIngresso)}`)),'Data ingresso nel periodo. Una riga per pratica.');
 metric('delivered','Vetture consegnate','count',delivered.map(v=>ref(v,1,`Consegna ${day(deliveredAt(v))}`)),'Data consegna effettiva, oppure evento di consegna nello storico. Le consegne senza una data registrata non sono attribuite a un periodo.');
 const tickets=delivered.map(v=>({v,m:recordValue(v,profits,parts)})),ticketRows=tickets.filter(x=>x.m.revenue!=null).map(x=>ref(x.v,x.m.revenue,'Ricavo previsto della pratica consegnata'));
 metric('ticket','Ticket medio lavori','money',ticketRows,'Valore medio IVA esclusa delle pratiche consegnate: ricavo del Profit Tracker o unico preventivo accettato. Non è un ticket fatturato. Più preventivi accettati senza riferimento esplicito rendono il valore sconosciuto.',ticketRows.length?sum(ticketRows)/ticketRows.length:null,tickets.length-ticketRows.length);
 const repairs=delivered.filter(v=>+new Date(deliveredAt(v))>=+new Date(v.dataIngresso)).map(v=>ref(v,(+new Date(deliveredAt(v))-+new Date(v.dataIngresso))/86400000,'Giorni di calendario: ingresso → consegna'));
 metric('repairTime','Tempo medio riparazione','days',repairs,'Tempo trascorso tra ingresso e consegna, inclusi attese, festivi e chiusure. Non ore di lavoro al banco.',repairs.length?sum(repairs)/repairs.length:null);
 unavailable('soldHours','Ore vendute','hours','Le quantità delle voci MANODOPERA non hanno un’unità di misura esplicita: non vengono interpretate automaticamente come ore vendute.');
 const hours=allocateHours(allEntries,r.start,r.end,now),hoursByVehicle=new Map();for(const row of hours.values())hoursByVehicle.set(row.vehicleId,(hoursByVehicle.get(row.vehicleId)||0)+row.hours);
 const hourRows=[...hoursByVehicle].filter(([id])=>byId.has(id)).map(([id,h])=>ref(byId.get(id),h,'Timer tecnici nel periodo, compresi segmenti in corso'));
 metric('workedHours','Ore lavorate','hours',hourRows,'Somma dei timer nel periodo. Intervalli simultanei dello stesso tecnico ripartiti tra le lavorazioni per non duplicare il tempo. Il tempo non registrato non può essere conteggiato.');
 const completed=workOrders.filter(w=>w.stato==='COMPLETATA'&&rangeHas((w.eventi||[]).filter(e=>e.tipo==='TERMINATA').sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt))[0]?.createdAt,r)),lifeHours=allocateHours(allEntries,-Infinity,now,now),productive=completed.filter(w=>lifeHours.get(w.id)?.hours>0),productiveRows=productive.filter(w=>byId.has(w.vehicleId)).map(w=>ref(byId.get(w.vehicleId),lifeHours.get(w.id).hours,`${w.titolo}: ${Number(w.oreStimate)} ore standard stimate; ${lifeHours.get(w.id).hours.toFixed(2)} ore reali`));
 const standard=productive.reduce((n,w)=>n+Number(w.oreStimate),0),real=sum(productiveRows);
 metric('productivity','Produttività standard/reale','percent',productiveRows,'Ore standard stimate / ore reali delle lavorazioni completate nel periodo. Considera l’intero ciclo dei relativi lavori, anche iniziati prima. Non equivale a ore vendute / presenza.',real?standard/real*100:null,completed.length-productive.length);
 const techIds=new Set(settings?.technicians?.map(t=>t.userId)||[]);let capacity=0;
 if(settings?.calendarConfirmed)for(let d=r.from;d<=r.to;d=addDays(d,1))if(openDay(d,settings))for(const t of settings.technicians)if(!t.unavailableDates.includes(d)){const a=romeTime(d,settings.startHour),b=a+Math.min(t.hoursPerDay,settings.hoursPerDay)*3600000;capacity+=Math.max(0,Math.min(b,r.end)-Math.max(a,r.start))/3600000;}
 const configured=allocateHours(allEntries.filter(e=>techIds.has(e.tecnicoId)),r.start,r.end,now),capacityRows=[...configured.values()].filter(e=>byId.has(e.vehicleId)).map(e=>ref(byId.get(e.vehicleId),e.hours,'Ore timer dei tecnici inclusi nel calendario'));
 metric('capacity','Capacità utilizzata','percent',capacityRows,`Ore timer / ore disponibili secondo il calendario configurato (${capacity.toFixed(2)} ore). Include solo i tecnici del calendario. È utilizzo della capacità programmata, non rilevazione delle presenze. Per il passato usa la configurazione disponibile oggi.`,settings?.calendarConfirmed&&capacity>0?sum(capacityRows)/capacity*100:null);
 const snapshot=vehicles.map(v=>({v,state:stateAt(v,r,now)})).filter(x=>+new Date(x.v.dataIngresso)<r.end),open=snapshot.filter(x=>x.state&&x.state!=='CONSEGNATA'),unknownStates=snapshot.filter(x=>!x.state).length;
 const partBlocked=v=>(v.partBlocks||[]).some(b=>+new Date(b.startedAt)<r.end&&(!b.endedAt||+new Date(b.endedAt)>=r.end));
 const paused=v=>{const states=workOrders.filter(w=>w.vehicleId===v.id).map(w=>{const e=(w.eventi||[]).filter(e=>+new Date(e.createdAt)<r.end&&e.aStato).sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt))[0];return e?.aStato||(r.end>=now?w.stato:null);});return states.includes('IN_PAUSA')&&!states.includes('IN_CORSO');};
 const blocked=open.filter(x=>partBlocked(x.v)||paused(x.v)||x.state==='ATTESA_APPROVAZIONE');
 metric('late','Vetture in ritardo','count',open.filter(x=>x.v.dataPrevistaConsegna&&day(x.v.dataPrevistaConsegna)<day(new Date(r.end-1))).map(x=>ref(x.v,1,`Promessa ${day(x.v.dataPrevistaConsegna)}`)),'Vetture aperte alla fine dell’intervallo con promessa scaduta. La promessa non ha uno storico delle rettifiche: confronto precedente non disponibile.',r.end>=now?undefined:null,unknownStates);
 metric('stopped','Vetture ferme / in attesa','count',blocked.map(x=>ref(x.v,1,partBlocked(x.v)?'Blocco ricambi registrato':paused(x.v)?'Lavorazioni in pausa, nessuna attiva':'Attesa approvazione')),'Alla fine dell’intervallo: blocco ricambi, lavorazioni solo in pausa o attesa approvazione. Gli stati storici mancanti sono esclusi.',undefined,unknownStates);
 const blockedParts=snapshot.filter(x=>partBlocked(x.v)&&x.state!=='CONSEGNATA');
 metric('partsStopped','Vetture ferme per ricambi','count',blockedParts.map(x=>ref(x.v,1,'Intervallo di fermo Parts Tracking aperto al termine del periodo')),'Intervalli di fermo realmente registrati da Parts Tracking; le sole fasi Ordine ricambi non provano un fermo fisico.');
 const quotes=vehicles.flatMap(v=>(v.quotes||[]).map(q=>({...q,v}))).filter(q=>rangeHas(q.createdAt,r)),openQuotes=quotes.filter(q=>['BOZZA','INVIATO'].includes(q.stato)),decided=quotes.filter(q=>q.stato!=='BOZZA'),approved=decided.filter(q=>q.stato==='ACCETTATO');
 metric('openQuotes','Preventivi aperti','count',openQuotes.map(q=>ref(q.v,1,`Preventivo ${q.id} · ${q.stato}`)),'Stato attuale dei preventivi creati nel periodo, non ricostruzione storica del loro stato.');
 metric('approvalRate','Tasso approvazione','percent',decided.map(q=>ref(q.v,q.stato==='ACCETTATO'?1:0,`Preventivo ${q.id} · ${q.stato}`)),'Accettati / preventivi non in bozza creati nel periodo. Entrambi valutati nello stato attuale: le coorti recenti possono essere ancora in attesa.',decided.length?approved.length/decided.length*100:null);
 const wip=open.map(x=>({v:x.v,m:recordValue(x.v,profits,parts)})),wipRows=wip.filter(x=>x.m.revenue!=null).map(x=>ref(x.v,x.m.revenue,'Ricavo previsto della pratica aperta'));
 metric('wip','Valore lavori in corso','money',wipRows,'Ricavi previsti delle pratiche ancora aperte; non valore contabile delle rimanenze. Usa valori registrati oggi; nessuno storico economico disponibile.',r.end>=now?(wipRows.length?sum(wipRows):open.length?null:0):null,wip.length-wipRows.length+unknownStates);
 unavailable('receivables','Crediti da incassare','money','Mancano scadenziario fatture e pagamenti collegati: dato non disponibile.');unavailable('cash','Incassi','money','Manca un registro dei pagamenti effettivi con data e importo.');
 const cohort=arrived,valued=vs=>vs.map(v=>ref(v,recordValue(v,profits,parts).revenue,'Valore della pratica registrato oggi'));
 const stage=(id,label,vs)=>{const rows=valued(vs).map((row,i)=>id==='quoted'&&row.value==null&&vs[i].quotes?.length===1?{...row,value:Math.round(Number(vs[i].quotes[0].imponibile)*100),detail:'Unico preventivo disponibile, IVA esclusa'}:row),missing=rows.filter(r=>r.value==null).length;return {id,label,count:rows.length,amount:missing?null:sum(rows),missing,rows};};
 const quoted=cohort.filter(v=>v.quotes?.length),accepted=cohort.filter(v=>v.quotes?.some(q=>q.stato==='ACCETTATO')),started=cohort.filter(v=>workOrders.some(w=>w.vehicleId===v.id&&(w.eventi||[]).some(e=>e.tipo==='INIZIATA'))||(v.stageHistory||[]).some(h=>['IN_LAVORAZIONE','PREPARAZIONE','VERNICIATURA','RIMONTAGGIO','CONTROLLO_QUALITA','PRONTA_CONSEGNA','CONSEGNATA'].includes(h.toStage))),done=cohort.filter(v=>v.stage==='PRONTA_CONSEGNA'||deliveredAt(v));
 return {kpis,funnel:[stage('quoted','Preventivato',quoted),stage('approved','Approvato',accepted),stage('working','In lavorazione',started),stage('completed','Completato',done),{id:'invoiced',label:'Fatturato',count:null,amount:null,rows:[],note:'Registro fatture assente'},{id:'paid',label:'Incassato',count:null,amount:null,rows:[],note:'Registro incassi assente'}],funnelNote:'Coorte delle vetture entrate nel periodo: fasi documentate raggiunte fino a oggi, non una somma di ricavi. Non forziamo le fasi mancanti. Valori dal Profit Tracker o unico preventivo accettato; per Preventivato anche l�unico preventivo disponibile. Importi ambigui non sommati.'};
}
export function buildExecutive(ctx,query,now=new Date()){
 const period=executivePeriod(query,now),current=executiveMetrics(ctx,period,+now),previous=executiveMetrics(ctx,period.previous,+now);
 for(const k of current.kpis){const p=previous.kpis.find(x=>x.id===k.id);k.previous=p.value;k.previousRows=p.rows;k.delta=k.value!=null&&p.value!=null?k.value-p.value:null;k.trendPercent=k.delta!=null&&p.value!==0?k.delta/Math.abs(p.value)*100:null;if(['late','wip','capacity'].includes(k.id)){k.previous=null;k.delta=null;k.trendPercent=null;k.trendNote='Serie storica confrontabile non disponibile per questo indicatore.';}}
 return {...current,period,generatedAt:now.toISOString()};
}
