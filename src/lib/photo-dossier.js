import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {photoMeta,PHOTO_CATEGORIES} from './photo-timeline.js';
const clean=v=>String(v??'Non disponibile').replace(/[\u{1F000}-\u{1FFFF}]/gu,'').replace(/[\u2010-\u2015]/g,'-');
const when=v=>v?new Date(v).toLocaleString('it-IT',{timeZone:'Europe/Rome'}):'Non disponibile';
const audienceLabels={CLIENTE:'Copia cliente',ASSICURAZIONE:'Copia assicurazione',INTERNO:'Documentazione interna'};
export async function buildPhotoDossier({tenant,vehicle,photos,parts=[],quotes=[],audience='CLIENTE',comparison=null,loadImage}){
 const doc=new PDFDocument({size:'A4',margins:{top:48,left:48,right:48,bottom:20},bufferPages:true,info:{Title:`Dossier fotografico ${vehicle.targa}`,Author:tenant.ragioneSociale,Subject:audienceLabels[audience]}}),chunks=[];
 const complete=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const width=499,bottom=775;let y=0;
 const header=()=>{doc.rect(0,0,596,8).fill('#B58B3B');doc.font('Helvetica-Bold').fontSize(10).fillColor('#172E45').text(clean(tenant.ragioneSociale),48,27,{width:width,height:26});doc.font('Helvetica').fontSize(8).fillColor('#667584').text(clean(`${vehicle.targa}  |  ${audienceLabels[audience]}`),48,57,{width});y=88;};
 const page=()=>{doc.addPage();header();};header();
 const text=(value,{bold=false,size=10,color='#283F51'}={})=>{const valueText=clean(value);doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);const h=doc.heightOfString(valueText,{width,lineGap:3});if(y+h>bottom)page();doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color).text(valueText,48,y,{width,lineGap:3});y+=h+6;};
 const heading=value=>{if(y>700)page();y+=8;text(value,{bold:true,size:15,color:'#172E45'});};
 text('DOSSIER FOTOGRAFICO',{bold:true,size:27});text(`${vehicle.marca} ${vehicle.modello} - ${vehicle.targa}`,{size:17});text(`Pratica ${vehicle.id}`);text(`Generato il ${when(new Date())}`);text(audienceLabels[audience],{bold:true,color:'#906D29'});
 heading('Dati della pratica');
 for(const line of [`Cliente: ${vehicle.client?.nome||''} ${vehicle.client?.cognome||''}`,`Veicolo: ${vehicle.marca} ${vehicle.modello}`,`Targa: ${vehicle.targa} | Telaio: ${vehicle.vin||'Non registrato'}`,`Ingresso: ${when(vehicle.dataIngresso)}`,`Consegna promessa: ${when(vehicle.dataPrevistaConsegna)}`,`Consegna effettiva: ${when(vehicle.dataConsegnaEffettiva)}`,`Stato attuale: ${vehicle.stage.replaceAll('_',' ')}`])text(line);
 if(audience!=='CLIENTE'){text(`Assicurazione: ${vehicle.compagniaAssicurativa||vehicle.sinistri?.map(s=>s.compagniaAssicurativa).filter(Boolean).join(', ')||'Non registrata'}`);text(`Numero sinistro: ${vehicle.numeroSinistro||vehicle.sinistri?.map(s=>s.numeroSinistro).filter(Boolean).join(', ')||'Non registrato'}`);}
 heading('Contenuto fotografico');text(`${photos.length} fotografie selezionate. Le date di scatto, quando presenti, sono dichiarate dall'operatore; la data di caricamento è registrata dal CRM.`);
 for(const [category,label] of Object.entries(PHOTO_CATEGORIES)){const n=photos.filter(p=>photoMeta(p).category===category).length;if(n)text(`${label}: ${n}`);}
 const unclassified=photos.filter(p=>!photoMeta(p).category).length;if(unclassified)text(`Da classificare: ${unclassified} (fase storica conservata).`);
 if(!photos.some(p=>['CONTROLLO_QUALITA','CONSEGNA'].includes(photoMeta(p).category)))text('Fotografie finali non presenti nella selezione.');
 heading('Lavorazioni documentate');const work=photos.filter(p=>photoMeta(p).workDescription);
 if(!work.length)text('Nessuna descrizione delle lavorazioni registrata nelle fotografie selezionate.');
 work.forEach(p=>text(`Foto ${photos.indexOf(p)+1}: ${photoMeta(p).workDescription}`));
 if(quotes.length){heading('Voci dei preventivi accettati');text('Queste voci descrivono lavori previsti; non attestano da sole la loro esecuzione.');for(const q of quotes)for(const item of q.items||[])text(`${item.descrizione} - Quantità ${item.quantita}`);}
 heading('Ricambi della pratica');if(!parts.length)text('Nessun ricambio registrato in Parts Tracking.');
 for(const p of parts)text(`${p.data.code} - ${p.data.description} | ${p.data.quantity} pz | ${p.status.replaceAll('_',' ')}${p.data.cancelled?' | ANNULLATO':''}${p.data.returnState!=='NONE'?' | Reso registrato':''}${audience==='INTERNO'?` | Fornitore: ${p.data.supplier||'Non indicato'}`:''}`);
 heading('Danni nascosti');const hidden=photos.filter(p=>photoMeta(p).category==='DANNI_NASCOSTI');
 text(hidden.length?`${hidden.length} fotografie classificate dall'operatore come danni nascosti. Consultare le relative pagine e annotazioni.`:'Nessun danno nascosto classificato nelle fotografie selezionate. Questo non certifica l’assenza di danni nascosti.');
 const cache=new Map();
 async function asset(p){if(cache.has(p.id))return cache.get(p.id);let result;try{const buffer=await loadImage(p),meta=await sharp(buffer).metadata();result={buffer,width:meta.width,height:meta.height};}catch{result=null;}cache.set(p.id,result);return result;}
 async function picture(p,x,top,w,h){const a=await asset(p);if(!a){doc.save().rect(x,top,w,h).fill('#F0F3F6').fillColor('#9A3528').fontSize(12).text('Fotografia non disponibile',x+12,top+25,{width:w-24}).restore();return false;}
  const scale=Math.min(w/a.width,h/a.height),iw=a.width*scale,ih=a.height*scale,ix=x+(w-iw)/2,iy=top+(h-ih)/2;doc.image(a.buffer,ix,iy,{width:iw,height:ih});doc.save().lineWidth(2).strokeColor('#E13A30');for(const m of photoMeta(p).markers)doc.rect(ix+m.x*iw,iy+m.y*ih,m.w*iw,m.h*ih).stroke();doc.restore();return true;
 }
 for(let i=0;i<photos.length;i++){const p=photos[i],m=photoMeta(p);page();text(`${String(i+1).padStart(2,'0')}  ${PHOTO_CATEGORIES[m.category]||'Da classificare'}`,{bold:true,size:19});text(`Foto ${p.id}`,{size:8});text(`Scatto dichiarato: ${when(m.capturedAt)} | Caricamento: ${when(p.createdAt)}`,{size:9});text(`Autore caricamento: ${m.authorName||'Non registrato (foto storica)'}`,{size:9});
  const top=y;await picture(p,48,top,width,330);y=top+345;
  if(m.notes){heading('Annotazioni');text(m.notes);}if(m.workDescription){heading('Lavorazioni');text(m.workDescription);}if(m.markers.length){text('Riquadri rossi: evidenziazioni dell’operatore, senza alterare l’originale.',{size:9});for(const [j,mark] of m.markers.entries())if(mark.label)text(`${j+1}. ${mark.label}`,{size:9});}
  if(audience==='INTERNO'&&m.internalNotes){heading('Note interne');text(m.internalNotes);}
  if(!m.category&&m.ai?.category)text(`Categoria suggerita dall'AI, non confermata: ${PHOTO_CATEGORIES[m.ai.category]} (${m.ai.confidence}%).`,{size:9});
 }
 if(comparison){const a=photos.find(p=>p.id===comparison.before),b=photos.find(p=>p.id===comparison.after);if(a&&b){page();heading('Confronto prima / dopo');text('Abbinamento selezionato dall’operatore. Le fotografie possono avere inquadrature differenti.');const top=y;await picture(a,48,top,243,330);await picture(b,304,top,243,330);y=top+345;text(`PRIMA: foto ${photos.indexOf(a)+1} - DOPO: foto ${photos.indexOf(b)+1}`);}}
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.save().strokeColor('#D8E0E6').moveTo(48,790).lineTo(547,790).stroke();doc.font('Helvetica').fontSize(8).fillColor('#667584').text(`${audienceLabels[audience]}  |  ${i+1} / ${range.count}`,48,800,{width:499,lineBreak:false});doc.restore();}
 doc.end();return complete;
}
