import {prisma} from "./prisma.js";
import {day} from "./delay.js";
import {emptyLedger} from "./profit.js";
import {PART_STATES,FINANCIAL_PART_FIELDS,partDataSchema,isBlocking} from "./parts-tracking.js";
export const problem=(status,message)=>Object.assign(new Error(message),{status});
async function lockVehicle(tx,tenantId,vehicleId){
 const rows=await tx.$queryRaw`SELECT id,stage,"dataIngresso" FROM vehicles WHERE id=${vehicleId} AND "tenantId"=${tenantId} FOR UPDATE`;
 if(!rows.length)throw problem(404,"Pratica non disponibile");return rows[0];
}
export async function syncPartBlock(tx,tenantId,vehicle){
 const parts=await tx.trackedPart.findMany({where:{tenantId,vehicleId:vehicle.id}});
 const blocked=vehicle.stage!=="CONSEGNATA"&&parts.some(isBlocking);
 const open=await tx.vehiclePartBlock.findFirst({where:{tenantId,vehicleId:vehicle.id,endedAt:null}});
 if(blocked&&!open)await tx.vehiclePartBlock.create({data:{tenantId,vehicleId:vehicle.id}});
 if(!blocked&&open)await tx.vehiclePartBlock.updateMany({where:{tenantId,vehicleId:vehicle.id,endedAt:null},data:{endedAt:new Date()}});
}
async function validateLinks(tx,tenantId,vehicleId,currentId,data,orderItemId,catalogPartId){
 if(catalogPartId&&!await tx.part.findFirst({where:{tenantId,id:catalogPartId},select:{id:true}}))throw problem(400,"Ricambio magazzino estraneo alla carrozzeria");
 let order=null;
 if(orderItemId){order=await tx.supplierOrderItem.findFirst({where:{id:orderItemId,supplierOrder:{tenantId}},include:{supplierOrder:true}});if(!order)throw problem(400,"Voce ordine non disponibile");if(order.quantitaOrdinata!==data.quantity)throw problem(400,"La quantità deve coincidere con la voce ordine. Dividere la voce nell’ordine se destinata a più pratiche.");}
 const ledger=await tx.profitRecord.findFirst({where:{vehicleId,tenantId}});
 const others=await tx.trackedPart.findMany({where:{tenantId,vehicleId,...(currentId?{id:{not:currentId}}:{})}});
 for(const [key,phase] of [["replacePlannedCostId","planned"],["replaceActualCostId","actual"]])if(data[key]){
  if(!ledger?.data.costs.some(c=>c.id===data[key]&&c.category==="ricambi"&&c.phase===phase))throw problem(400,"Voce manuale Profit Tracker non valida per questa pratica");
  if(others.some(p=>p.data[key]===data[key]))throw problem(409,"Voce manuale già collegata a un altro ricambio");
 }
 return order;
}
export async function saveTrackedPart({tenantId,vehicleId,id,requestKey,version,data,status,reason,actorId,financial,orderItemId=null,catalogPartId=null}){
 return prisma.$transaction(async tx=>{
  const vehicle=await lockVehicle(tx,tenantId,vehicleId);
  if(!id){const previous=await tx.trackedPart.findFirst({where:{tenantId,requestKey}});if(previous){if(previous.vehicleId!==vehicleId)throw problem(409,"Richiesta già utilizzata");return previous;}}
  const current=id?await tx.trackedPart.findFirst({where:{id,tenantId,vehicleId}}):null;
  if(id&&!current)throw problem(404,"Ricambio non disponibile");
  if(current&&current.version!==version)throw problem(409,"Ricambio aggiornato da un altro operatore. Ricaricare prima di salvare.");
  if(!financial){for(const key of FINANCIAL_PART_FIELDS){if(Object.hasOwn(data,key))throw problem(403,"Prezzi e crediti richiedono un ruolo amministrativo");data[key]=current?.data[key]??(key==="creditCents"?0:null);}if(data.returnState==="CREDITED"&&current?.data.returnState!=="CREDITED")throw problem(403,"Solo amministrazione può confermare un rimborso");}
  const parsed=partDataSchema.safeParse(data);if(!parsed.success)throw problem(400,parsed.error.issues.map(i=>i.message).join("; "));
  data={...parsed.data,plannedUnitCents:parsed.data.plannedUnitCents??null,actualUnitCents:parsed.data.actualUnitCents??null,creditCents:parsed.data.creditCents??0,replacePlannedCostId:parsed.data.replacePlannedCostId??null,replaceActualCostId:parsed.data.replaceActualCostId??null};
  const from=current?PART_STATES.indexOf(current.status):0,to=PART_STATES.indexOf(status);
  if(to<0)throw problem(400,"Stato non valido");
  if((to<from||to>from+1||!current&&to>0||data.cancelled&&!current?.data.cancelled)&&!reason.trim())throw problem(400,"Specificare il motivo per rettifiche, salti di stato o annullamenti");
  if(current&&to>from){if(to>=1&&!data.orderedDate&&!orderItemId)data.orderedDate=day(new Date());if(to===4&&!data.arrivedDate)data.arrivedDate=day(new Date());}
  const order=await validateLinks(tx,tenantId,vehicleId,id,data,orderItemId,catalogPartId);
  if(order){data.orderedDate=day(order.supplierOrder.dataOrdine);data.eta=day(order.supplierOrder.dataConsegnaPrevista);if(!data.supplier)data.supplier=order.supplierOrder.fornitore;if(order.quantitaRicevuta>=data.quantity&&to<4)status="ARRIVATO";else if(to===0)status="ORDINATO";}
  const finalData=partDataSchema.safeParse(data);if(!finalData.success)throw problem(400,finalData.error.issues.map(i=>i.message).join("; "));
  const saved=current?await tx.trackedPart.update({where:{id},data:{status,data,orderItemId,catalogPartId,version:{increment:1}}}):await tx.trackedPart.create({data:{tenantId,vehicleId,requestKey,status,data,orderItemId,catalogPartId}});
  await tx.trackedPartEvent.create({data:{partId:saved.id,actorId,fromStatus:current?.status??null,toStatus:status,reason:reason.trim()||(current?"Aggiornamento ricambio":"Registrazione ricambio"),snapshot:{before:current?.data??null,after:data}}});
  // A derived cost source does not overwrite manual ledger data or increments of stock.
  await tx.profitRecord.upsert({where:{vehicleId},create:{tenantId,vehicleId,updatedById:actorId,data:emptyLedger(day(vehicle.dataIngresso))},update:{}});
  await syncPartBlock(tx,tenantId,vehicle);
  return saved;
 },{timeout:15000});
}
export async function refreshLinkedParts(tenantId,vehicleId){
 const linked=await prisma.trackedPart.findMany({where:{tenantId,...(vehicleId?{vehicleId}:{}),orderItemId:{not:null}}});
 if(!linked.length)return;
 const orders=await prisma.supplierOrderItem.findMany({where:{id:{in:linked.map(p=>p.orderItemId)},supplierOrder:{tenantId}},include:{supplierOrder:true}});
 for(const part of linked){
  if(part.data.cancelled)continue;
  const order=orders.find(o=>o.id===part.orderItemId);if(!order)continue;
  const eta=day(order.supplierOrder.dataConsegnaPrevista),arrived=order.quantitaRicevuta>=part.data.quantity&&PART_STATES.indexOf(part.status)<4;
  if(part.data.eta===eta&&!arrived)continue;
  await prisma.$transaction(async tx=>{
   const vehicle=await lockVehicle(tx,tenantId,part.vehicleId);
   const current=await tx.trackedPart.findFirst({where:{id:part.id,tenantId,version:part.version}});if(!current)return;
   const data={...current.data,eta},status=arrived?"ARRIVATO":current.status;
   // Existing orders have no actual arrival timestamp: keep it unknown until confirmed by an operator.
   await tx.trackedPart.update({where:{id:part.id},data:{data,status,version:{increment:1}}});
   await tx.trackedPartEvent.create({data:{partId:part.id,fromStatus:part.status,toStatus:status,reason:arrived?"Quantità completa ricevuta nell’ordine collegato; verificare data arrivo":"ETA aggiornata dall’ordine collegato",snapshot:{before:part.data,after:data}}});
   await syncPartBlock(tx,tenantId,vehicle);
  });
 }
}
