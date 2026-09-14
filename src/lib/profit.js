import { z } from "zod";
export const CATEGORIES = ["ricambi", "materiali", "vernici", "carrozziere", "verniciatore", "meccanico", "esterne", "trasporto", "sostitutiva", "altri"];
const cents = z.number().int().min(0).max(1000000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
export const ledgerSchema = z.object({
  date, workType: z.string().trim().min(1).max(100),
  revenueMode: z.enum(["quote", "payers"]), quoteId: z.string().max(100).nullable(),
  revenue: z.object({ preventivo: cents.nullable(), integrazioni: cents, aggiuntivi: cents, assicurazione: cents.nullable(), cliente: cents.nullable(), altri: cents }).strict(),
  plannedComplete: z.boolean(), actualComplete: z.boolean(),
  costs: z.array(z.object({ id: z.string().min(1).max(100), category: z.enum(CATEGORIES), phase: z.enum(["planned", "actual"]), date,
    description: z.string().max(250), quantity: z.number().positive().max(100000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001), unitCents: cents }).strict().refine(c => c.quantity*c.unitCents <= 100000000000, "Importo riga troppo elevato")).max(500)
}).strict().refine(d => new Set(d.costs.map(c => c.id)).size === d.costs.length, "Identificativi costo duplicati");
export const settingsSchema = z.object({criticalBelow: z.number().int().min(0).max(99), goodFrom: z.number().int().min(1).max(100)}).strict().refine(s => s.criticalBelow < s.goodFrom, "La soglia buona deve superare quella critica");
export const DEFAULT_SETTINGS = {criticalBelow:20,goodFrom:35};
export function emptyLedger(day) { return {date:day,workType:"Riparazione",revenueMode:"quote",quoteId:null,revenue:{preventivo:null,integrazioni:0,aggiuntivi:0,assicurazione:null,cliente:null,altri:0},plannedComplete:false,actualComplete:false,costs:[]}; }
export function metrics(revenue, planned, actual, settings=DEFAULT_SETTINGS) {
 const pct = n => revenue === null || revenue === 0 ? null : n / revenue * 100;
 const plannedMargin = revenue === null ? null : revenue-planned;
 const actualMargin = revenue === null ? null : revenue-actual;
 const actualPercent = pct(actualMargin);
 return {revenue,planned,actual,plannedMargin,actualMargin,plannedPercent:pct(plannedMargin),actualPercent,variance:planned-actual,
   status:actualPercent === null ? "unknown" : actualPercent < settings.criticalBelow ? "critical" : actualPercent < settings.goodFrom ? "watch" : "good"};
}
export function calculate(data, quotes=[], settings=DEFAULT_SETTINGS) {
 const r = data.revenue;
 const quote = data.quoteId ? quotes.find(q=>q.id===data.quoteId && q.stato!=="RIFIUTATO") : null;
 const base = data.revenueMode === "payers" ? (r.assicurazione === null || r.cliente === null ? null : r.assicurazione+r.cliente) : data.quoteId ? (quote ? Math.round(Number(quote.imponibile)*100) : null) : r.preventivo;
 const revenue = base === null ? null : base+r.integrazioni+r.aggiuntivi+r.altri;
 const categories = CATEGORIES.map(category => {
   const sum = phase => data.costs.filter(c=>c.category===category && c.phase===phase).reduce((a,c)=>a+Math.round(c.quantity*c.unitCents),0);
   const planned=sum("planned"),actual=sum("actual");
   return {category,planned,actual,variance:planned-actual};
 });
 const planned=categories.reduce((a,c)=>a+c.planned,0), actual=categories.reduce((a,c)=>a+c.actual,0);
 return {...metrics(revenue,planned,actual,settings), categories, plannedComplete:data.plannedComplete,actualComplete:data.actualComplete,
   quoteStatus:quote?.stato??null, provisional:!data.actualComplete || !data.plannedComplete || revenue===null,
   note:"Importi IVA esclusa. Margine reale sui ricavi previsti e costi registrati; non equivale a utile netto o incassi."};
}
export function groupKey(record, group) {
 const d=record.data.date, v=record.vehicle;
 if(group==="technician") return v.tecnicoId || "unassigned";
 if(group==="insurance") {
  const insurers=[...new Set((v.sinistri??[]).map(s=>s.compagniaAssicurativa).filter(Boolean))];
  return v.compagniaAssicurativa || (insurers.length===1?insurers[0]:insurers.length>1?"Più assicurazioni":"Non specificata");
 }
 if(group==="workType") return record.data.workType;
 if(group==="year") return d.slice(0,4);
 if(group==="month") return d.slice(0,7);
 if(group==="week") { const x=new Date(d+"T12:00:00Z"); x.setUTCDate(x.getUTCDate() - (x.getUTCDay()+6)%7); return x.toISOString().slice(0,10); }
 return d;
}
export function aggregate(records, group, settings) {
 const groups=new Map();
 for(const record of records) {
  const key=groupKey(record,group), m=calculate(record.data,record.vehicle.quotes,settings);
  if(!groups.has(key)) groups.set(key,{key,label:group==="technician" ? (record.vehicle.tecnico ? `${record.vehicle.tecnico.nome} ${record.vehicle.tecnico.cognome}` : "Non assegnato") : key,count:0,incomplete:0,missingRevenue:0,revenue:0,planned:0,actual:0});
  const g=groups.get(key); g.count++; g.incomplete+=Number(m.provisional); g.missingRevenue+=Number(m.revenue===null); g.revenue+=m.revenue??0; g.planned+=m.planned;g.actual+=m.actual;
 }
 return [...groups.values()].map(g=>({...g,...metrics(g.missingRevenue ? null:g.revenue,g.planned,g.actual,settings)})).sort((a,b)=>a.key.localeCompare(b.key));
}
