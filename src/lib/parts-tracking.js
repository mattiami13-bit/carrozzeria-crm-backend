import {z} from "zod";
import {dateSchema,day} from "./delay.js";
export const PART_STATES=["DA_ORDINARE","ORDINATO","CONFERMATO","IN_TRANSITO","ARRIVATO","CONTROLLATO","MONTATO"];
export const FINANCIAL_PART_FIELDS=["plannedUnitCents","actualUnitCents","creditCents","replacePlannedCostId","replaceActualCostId"];
const cents=z.number().int().min(0).max(1000000000);
export const partDataSchema=z.object({
 code:z.string().trim().min(1).max(100),description:z.string().trim().min(1).max(250),kind:z.enum(["OEM","AFTERMARKET"]),supplier:z.string().trim().max(200),quantity:z.number().int().min(1).max(10000),
 plannedUnitCents:cents.nullable().optional(),actualUnitCents:cents.nullable().optional(),orderedDate:dateSchema.nullable(),eta:dateSchema.nullable(),arrivedDate:dateSchema.nullable(),
 documentRef:z.string().max(250),notes:z.string().max(2000),blocking:z.boolean(),cancelled:z.boolean(),
 returnState:z.enum(["NONE","REQUESTED","SENT","CREDITED"]),returnedQty:z.number().int().min(0).max(10000),returnDate:dateSchema.nullable(),returnReason:z.string().max(500),replacementNeeded:z.boolean(),creditCents:cents.optional(),
 replacePlannedCostId:z.string().max(100).nullable().optional(),replaceActualCostId:z.string().max(100).nullable().optional()
}).strict().superRefine((d,c)=>{
 const issue=message=>c.addIssue({code:z.ZodIssueCode.custom,message});
 if(d.returnedQty>d.quantity)issue("Quantità resa superiore a quella acquistata");
 if(d.returnState==="NONE"&&(d.returnedQty||d.creditCents))issue("Indicare lo stato del reso");
 if(d.returnState!=="NONE"&&(!d.returnedQty||!d.returnReason.trim()))issue("Il reso richiede quantità e motivazione");
 if(["SENT","CREDITED"].includes(d.returnState)&&!d.returnDate)issue("Inserire la data del reso");
 if((d.creditCents??0)>0&&(d.returnState!=="CREDITED"||d.actualUnitCents==null||d.creditCents>d.returnedQty*d.actualUnitCents))issue("Credito reso non valido: indicare solo il rimborso confermato");
 if(d.orderedDate&&d.arrivedDate&&d.arrivedDate<d.orderedDate)issue("Arrivo precedente all’ordine");
 if(d.quantity*Math.max(d.plannedUnitCents??0,d.actualUnitCents??0)>100000000000)issue("Importo troppo elevato");
});
export function emptyTrackedPart(){return {code:"",description:"",kind:"OEM",supplier:"",quantity:1,plannedUnitCents:null,actualUnitCents:null,orderedDate:null,eta:null,arrivedDate:null,documentRef:"",notes:"",blocking:false,cancelled:false,returnState:"NONE",returnedQty:0,returnDate:null,returnReason:"",replacementNeeded:false,creditCents:0,replacePlannedCostId:null,replaceActualCostId:null};}
export function isBlocking(part){const d=part.data;return !d.cancelled&&d.blocking&&(d.replacementNeeded&&d.returnState!=="NONE"||PART_STATES.indexOf(part.status)<5);}
export function partAlerts(part,now=new Date()){
 const d=part.data;if(d.cancelled)return[];
 const alerts=[];const stage=PART_STATES.indexOf(part.status);
 if(stage===0)alerts.push({code:"NOT_ORDERED",message:"⚠️ Ricambio non ordinato"});
 if(d.eta&&d.eta<day(now)&&stage<4)alerts.push({code:"ETA_OVERDUE",message:"⚠️ ETA superata"});
 if(d.actualUnitCents!=null&&d.plannedUnitCents!=null&&d.actualUnitCents>d.plannedUnitCents)alerts.push({code:"OVER_BUDGET",message:"⚠️ Prezzo superiore al preventivato"});
 if(stage===4)alerts.push({code:"UNCHECKED",message:"⚠️ Ricambio arrivato ma non controllato"});
 if(isBlocking(part))alerts.push({code:"BLOCKING",message:"⚠️ Vettura bloccata per ricambio"});
 return alerts;
}
export function projectPart(part,financial){
 const data={...part.data};if(!financial)for(const k of FINANCIAL_PART_FIELDS)delete data[k];
 return {...part,data,alerts:partAlerts(part).filter(a=>financial||a.code!=="OVER_BUDGET"),events:part.events?.map(e=>({id:e.id,fromStatus:e.fromStatus,toStatus:e.toStatus,reason:e.reason,createdAt:e.createdAt})),documents:financial?part.documents:[]};
}
export function blockedDuration(intervals,now=new Date()){
 const spans=intervals.map(i=>[new Date(i.startedAt).getTime(),Math.min(new Date(i.endedAt??now).getTime(),new Date(now).getTime())]).filter(([a,b])=>b>=a).sort((a,b)=>a[0]-b[0]);
 let ms=0,end=-Infinity;for(const [a,b] of spans){ms+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}
 return {hours:ms/3600000,days:ms/86400000,active:intervals.some(i=>!i.endedAt)};
}
export function partsProfitData(data,parts=[]){
 const replacedCostIds=[],automaticCosts=[];let plannedMissing=false,actualMissing=false;
 for(const part of parts){const d=part.data;
  for(const [phase,price,key] of [["planned",d.plannedUnitCents,"replacePlannedCostId"],["actual",d.actualUnitCents,"replaceActualCostId"]]){
   if(phase==="planned"&&d.cancelled)continue;
   if(price==null){if(!d.cancelled){if(phase==="planned")plannedMissing=true;else actualMissing=true;}continue;}
   // Only replace a manual row once a usable tracked amount exists. The original row is preserved.
   if(d[key])replacedCostIds.push(d[key]);
   const total=price*d.quantity-(phase==="actual"?(d.creditCents??0):0);
   automaticCosts.push({id:`parts:${part.id}:${phase}`,category:"ricambi",phase,date:d.arrivedDate??d.orderedDate??day(part.createdAt),description:`${d.code} · ${d.description} (${d.quantity} pz)${phase==="actual"&&d.creditCents?" · al netto del reso":""}`,quantity:1,unitCents:total});
  }
 }
 return {data:{...data,costs:[...data.costs.filter(c=>!replacedCostIds.includes(c.id)),...automaticCosts],plannedComplete:data.plannedComplete&&!plannedMissing,actualComplete:data.actualComplete&&!actualMissing},automaticCosts,replacedCostIds,plannedMissing,actualMissing};
}
export function trackingDependencies(parts){return parts.filter(p=>!p.data.cancelled).map(p=>({id:`parts:${p.id}`,kind:"part",description:p.data.description+(p.status==="ARRIVATO"?" (arrivato, da controllare)":""),done:!isBlocking({...p,data:{...p.data,blocking:true}}),eta:p.data.replacementNeeded&&p.data.returnState!=="NONE"?null:p.status==="ARRIVATO"?day(new Date()):p.data.eta,source:"Parts Tracking"}));}
export function validDocument(buffer,mime){return mime==="application/pdf"?buffer.subarray(0,5).toString()==="%PDF-":mime==="image/png"?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==="image/jpeg"?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:false;}
