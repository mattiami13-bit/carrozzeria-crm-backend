import {z} from 'zod';
import {supabase,PHOTOS_BUCKET} from './supabase.js';
export const PHOTO_CATEGORIES={ACCETTAZIONE:'Accettazione',DANNI_INIZIALI:'Danni iniziali',SMONTAGGIO:'Smontaggio',DANNI_NASCOSTI:'Danni nascosti',RIPARAZIONE:'Riparazione',PREPARAZIONE:'Preparazione',VERNICIATURA:'Verniciatura',RIMONTAGGIO:'Rimontaggio',CONTROLLO_QUALITA:'Controllo qualità',CONSEGNA:'Consegna'};
export const categorySchema=z.enum(Object.keys(PHOTO_CATEGORIES));
export const markerSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1),label:z.string().max(100)}).strict().refine(m=>m.x+m.w<=1.000001&&m.y+m.h<=1.000001,'Evidenziazione fuori dalla fotografia');
export const timelineEditSchema=z.object({category:categorySchema.nullable(),capturedAt:z.string().datetime({offset:true}).nullable(),notes:z.string().max(1500),internalNotes:z.string().max(1500),workDescription:z.string().max(1500),markers:z.array(markerSchema).max(20)}).strict();
export const suggestionSchema=z.object({category:categorySchema.nullable(),confidence:z.number().int().min(0).max(100),reason:z.string().max(600)}).strict();
export function phaseForCategory(category,fallback='DURANTE'){return category==null?fallback:['ACCETTAZIONE','DANNI_INIZIALI'].includes(category)?'PRIMA':['CONTROLLO_QUALITA','CONSEGNA'].includes(category)?'DOPO':'DURANTE';}
export function photoMeta(photo){return {category:null,capturedAt:null,authorId:null,authorName:null,notes:'',internalNotes:'',workDescription:'',markers:[],ai:null,...(photo.timeline||{})};}
export function sortedPhotos(photos){const keys=Object.keys(PHOTO_CATEGORIES);return [...photos].sort((a,b)=>{const x=photoMeta(a),y=photoMeta(b);return (x.category?keys.indexOf(x.category):99)-(y.category?keys.indexOf(y.category):99)||new Date(x.capturedAt||a.createdAt)-new Date(y.capturedAt||b.createdAt);});}
export function photoStoragePath(photo,tenantId,baseUrl,bucket){
 const url=new URL(photo.url),base=new URL(baseUrl),prefix=`/storage/v1/object/public/${bucket}/`;
 if(url.origin!==base.origin||!url.pathname.startsWith(prefix))throw new Error('Archivio foto non riconosciuto');
 const path=decodeURIComponent(url.pathname.slice(prefix.length));
 if(!path.startsWith(`${tenantId}/${photo.vehicleId}/`)||path.split('/').some(p=>p==='..'||p==='.')||path.includes('\\'))throw new Error('Foto esterna alla pratica');
 return path;
}
export function dossierPhotos(photos,ids){if(ids==null)return sortedPhotos(photos);if(new Set(ids).size!==ids.length||ids.some(id=>!photos.some(p=>p.id===id)))throw new Error('Selezione foto non valida per questa pratica');return sortedPhotos(photos.filter(p=>ids.includes(p.id)));}

export const legacyPhotoSelect={id:true,vehicleId:true,fase:true,url:true,createdAt:true,visibilePortale:true};
export function publicPhoto(p){return {id:p.id,vehicleId:p.vehicleId,fase:p.fase,url:p.url,createdAt:p.createdAt};}

// Le foto sono su un bucket Storage privato: un URL pubblico permanente
// darebbe accesso per sempre a chiunque lo ottenga (log, referrer, link
// condivisi). Firmiamo un URL a breve scadenza solo quando la foto viene
// effettivamente restituita a un client, mai memorizzato.
const SIGNED_URL_TTL_SECONDS = 60 * 60;
async function signedUrlFor(photo,url,tenantId){
 if(!url)return null;
 try{
  const path=photoStoragePath({...photo,url},tenantId,process.env.SUPABASE_URL,PHOTOS_BUCKET);
  const {data,error}=await supabase.storage.from(PHOTOS_BUCKET).createSignedUrl(path,SIGNED_URL_TTL_SECONDS);
  if(error||!data)return null;
  return data.signedUrl;
 }catch{return null;}
}
export async function signPhoto(photo,tenantId){
 const url=await signedUrlFor(photo,photo.url,tenantId);
 let timeline=photo.timeline;
 if(timeline?.originalUrl){
  const originalUrl=await signedUrlFor(photo,timeline.originalUrl,tenantId);
  timeline={...timeline,originalUrl};
 }
 return {...photo,url,timeline};
}
export function signPhotos(photos,tenantId){return Promise.all(photos.map(p=>signPhoto(p,tenantId)));}
