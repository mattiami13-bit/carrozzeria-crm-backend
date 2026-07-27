import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { supabase, PHOTOS_BUCKET } from "../lib/supabase.js";

export const photosRouter = Router();
photosRouter.use(requireAuth);

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
photosRouter.post("/vehicles/:vehicleId/photos", upload.single("file"), async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.vehicleId, ...tenantScope(req) },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  if (!req.file) {
    return res.status(400).json({ error: "Nessun file caricato" });
  }

  const parsedFase = faseSchema.safeParse(req.body.fase);
  if (!parsedFase.success) {
    return res.status(400).json({ error: "Fase non valida (PRIMA, DURANTE o DOPO)" });
  }

  const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
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

  const { data: publicUrlData } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);

  const photo = await prisma.photo.create({
    data: {
      vehicleId: vehicle.id,
      fase: parsedFase.data,
      url: publicUrlData.publicUrl,
    },
  });

  res.status(201).json(photo);
});

// DELETE /api/photos/:id
photosRouter.delete("/photos/:id", async (req, res) => {
  const photo = await prisma.photo.findFirst({
    where: { id: req.params.id, vehicle: tenantScope(req) },
  });
  if (!photo) return res.status(404).json({ error: "Foto non trovata" });

  const marker = `/${PHOTOS_BUCKET}/`;
  const idx = photo.url.indexOf(marker);
  if (idx !== -1) {
    const storagePath = photo.url.slice(idx + marker.length);
    await supabase.storage.from(PHOTOS_BUCKET).remove([storagePath]);
  }

  await prisma.photo.delete({ where: { id: photo.id } });
  res.status(204).send();
});
