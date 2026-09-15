import sharp from 'sharp';
import { categorySchema,phaseForCategory,photoStoragePath,signPhoto } from '../lib/photo-timeline.js';
import { savePhotoSuggestion,normalizePhoto } from '../lib/photo-timeline-service.js';
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { supabase, PHOTOS_BUCKET } from "../lib/supabase.js";

export const photosRouter = Router();
photosRouter.use(requireAuth);
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
photosRouter.use(wrap(async(req,res,next)=>{const user=await prisma.user.findFirst({where:{id:req.auth.userId,tenantId:req.auth.tenantId,attivo:true},select:{nome:true,cognome:true,ruolo:true}});if(!user)return res.status(403).json({error:"Account non attivo"});req.photoUser=user;next();}));
const photoScope=req=>({...tenantScope(req),...(req.photoUser.ruolo==="TECNICO"?{tecnicoId:req.auth.userId}:{})});

// Le foto restano in memoria solo per il tempo di inoltrarle a Supabase
// Storage (nessun file temporaneo scritto su disco). Limite 10MB, solo
// immagini: sufficiente per foto da smartphone senza appesantire troppo
// l'upload da rete mobile in officina.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Sono ammesse solo immagini"));
    }
    cb(null, true);
  },
});

const faseSchema = z.enum(["PRIMA", "DURANTE", "DOPO"]);

// POST /api/vehicles/:vehicleId/photos
// multipart/form-data con campi: file (l'immagine), fase (PRIMA|DURANTE|DOPO)
photosRouter.post("/vehicles/:vehicleId/photos", upload.single("file"), wrap(async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.vehicleId, ...photoScope(req) },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  if (!req.file) {
    return res.status(400).json({ error: "Nessun file caricato" });
  }

  const parsedFase = faseSchema.safeParse(req.body.fase);
  if (!parsedFase.success) {
    return res.status(400).json({ error: "Fase non valida (PRIMA, DURANTE o DOPO)" });
  }

  const category=req.body.category?categorySchema.safeParse(req.body.category):{success:true,data:null};
  if(!category.success)return res.status(400).json({error:"Categoria non valida"});
  let meta;try{meta=await sharp(req.file.buffer,{limitInputPixels:60000000}).metadata();}catch{return res.status(400).json({error:"Immagine non leggibile. Esporta la foto come JPEG, PNG o WebP."});}
  const ext={jpeg:"jpg",png:"png",webp:"webp",gif:"gif",tiff:"tiff",heif:"heif",avif:"avif"}[meta.format];
  if(!ext)return res.status(400).json({error:"Formato fotografia non supportato"});
  let preview;try{preview=await normalizePhoto(req.file.buffer,2400);}catch{return res.status(400).json({error:"Immagine non decodificabile: esportala come JPEG o PNG"});}
  // Path organizzato per tenant/veicolo: evita collisioni tra carrozzerie
  // diverse e rende facile in futuro cancellare tutte le foto di un tenant.
  const path = `${req.auth.tenantId}/${vehicle.id}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(path, req.file.buffer, { contentType: req.file.mimetype });

  if (uploadError) {
    console.error("Errore upload Supabase Storage:", uploadError);
    return res.status(500).json({ error: "Errore durante il caricamento della foto" });
  }

  const previewPath=path+'.preview.jpg';
  const {error:previewError}=await supabase.storage.from(PHOTOS_BUCKET).upload(previewPath,preview,{contentType:'image/jpeg'});
  if(previewError){await supabase.storage.from(PHOTOS_BUCKET).remove([path]);return res.status(500).json({error:'Impossibile salvare anteprima foto. Riprova.'});}
  const {data:originalUrlData}=supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
  const {data:publicUrlData}=supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(previewPath);

  let photo;try{photo = await prisma.photo.create({
    data: {
      vehicleId: vehicle.id,
      fase: phaseForCategory(category.data,parsedFase.data),
      timeline:{originalUrl:originalUrlData.publicUrl,category:category.data,capturedAt:null,authorId:req.auth.userId,authorName:`${req.photoUser.nome} ${req.photoUser.cognome}`,notes:"",internalNotes:"",workDescription:"",markers:[],ai:null},
      url: publicUrlData.publicUrl,
    },
  });

  }catch(e){await supabase.storage.from(PHOTOS_BUCKET).remove([path,previewPath]);throw e;}
  try{photo=await savePhotoSuggestion(photo,req.auth.tenantId,req.file.buffer)||photo;}catch{ /* Preserve a successful upload if AI metadata cannot be saved. */ }
  res.status(201).json(await signPhoto(photo,req.auth.tenantId));
}));

// PATCH /api/photos/:id/visibilita — mostra/nascondi una foto nel portale
// cliente senza eliminarla (es. scatti di dettaglio non da mostrare).
photosRouter.patch("/photos/:id/visibilita", wrap(async (req, res) => {
  const parsed = z.object({ visibilePortale: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valore non valido" });

  const { count } = await prisma.photo.updateMany({
    where: { id: req.params.id, vehicle: photoScope(req) },
    data: { visibilePortale: parsed.data.visibilePortale },
  });
  if (count === 0) return res.status(404).json({ error: "Foto non trovata" });
  res.status(204).send();
}));

// DELETE /api/photos/:id
photosRouter.delete("/photos/:id", wrap(async (req, res) => {
  const photo = await prisma.photo.findFirst({
    where: { id: req.params.id, vehicle: photoScope(req) },
  });
  if (!photo) return res.status(404).json({ error: "Foto non trovata" });

  const paths=[];
  for(const url of [photo.url,photo.timeline?.originalUrl].filter(Boolean)){try{paths.push(photoStoragePath({...photo,url},req.auth.tenantId,process.env.SUPABASE_URL,PHOTOS_BUCKET));}catch{}}
  if(paths.length){const {error}=await supabase.storage.from(PHOTOS_BUCKET).remove(paths);if(error)return res.status(502).json({error:'Impossibile eliminare i file della foto. Riprova.'});}

  await prisma.photo.delete({ where: { id: photo.id } });
  res.status(204).send();
}));

photosRouter.use((err,req,res,next)=>{if(err instanceof multer.MulterError)return res.status(400).json({error:"Foto troppo grande: massimo 10 MB per file"});next(err);});
