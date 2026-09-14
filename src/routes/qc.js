import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { DEFAULT_CHECKLIST, ESITI, vociCriticheBloccanti, vociNonValutate } from "../lib/qc.js";

// Quality Control: checklist obbligatoria prima di passare una pratica a
// "Pronta" (bloccata direttamente in routes/vehicles.js, non qui — questo
// modulo si occupa solo di gestire ispezioni/esiti/non conformità e di
// esporre se l'ultima ispezione del veicolo è approvabile/approvata).

export const qcTemplateRouter = Router();
qcTemplateRouter.use(requireAuth);

export const vehicleQcRouter = Router({ mergeParams: true });
vehicleQcRouter.use(requireAuth);

export const qcInspectionRouter = Router();
qcInspectionRouter.use(requireAuth);

export const qcNonConformitaRouter = Router();
qcNonConformitaRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const slugify = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

// --- Checklist (template) ---

// GET /api/qc/template — checklist del tenant, con le voci di default non
// ancora personalizzate mostrate come bozza (nessuna scrittura).
qcTemplateRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const salvati = await prisma.qcChecklistItem.findMany({ where: { tenantId }, orderBy: { ordine: "asc" } });
  const salvatiByChiave = new Map(salvati.map((v) => [v.chiave, v]));

  const risultato = [];
  for (const def of DEFAULT_CHECKLIST) {
    const s = salvatiByChiave.get(def.chiave);
    risultato.push(s ? s : { id: null, chiave: def.chiave, etichetta: def.etichetta, ordine: def.ordine, critico: def.critico, attivo: true, personalizzato: false });
    salvatiByChiave.delete(def.chiave);
  }
  // Voci custom aggiunte dal tenant, non presenti nella checklist di esempio.
  for (const extra of salvatiByChiave.values()) risultato.push({ ...extra, personalizzato: true });

  risultato.sort((a, b) => a.ordine - b.ordine);
  res.json(risultato.map((v) => ({ ...v, personalizzato: v.personalizzato ?? true })));
}));

const upsertSchema = z.object({ etichetta: z.string().min(1).max(200), critico: z.boolean(), attivo: z.boolean(), ordine: z.number().int().optional() });

// PUT /api/qc/template/:chiave — crea o aggiorna una voce (ADMIN).
qcTemplateRouter.put("/:chiave", requireRole("ADMIN"), wrap(async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId } = tenantScope(req);
  const chiave = req.params.chiave;
  const def = DEFAULT_CHECKLIST.find((d) => d.chiave === chiave);
  const ordine = parsed.data.ordine ?? def?.ordine ?? 999;

  const item = await prisma.qcChecklistItem.upsert({
    where: { tenantId_chiave: { tenantId, chiave } },
    update: { etichetta: parsed.data.etichetta, critico: parsed.data.critico, attivo: parsed.data.attivo, ordine },
    create: { tenantId, chiave, etichetta: parsed.data.etichetta, critico: parsed.data.critico, attivo: parsed.data.attivo, ordine },
  });
  res.json(item);
}));

const nuovaVoceSchema = z.object({ etichetta: z.string().min(1).max(200), critico: z.boolean().default(true) });

// POST /api/qc/template — aggiunge una voce personalizzata (ADMIN).
qcTemplateRouter.post("/", requireRole("ADMIN"), wrap(async (req, res) => {
  const parsed = nuovaVoceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId } = tenantScope(req);
  const base = slugify(parsed.data.etichetta) || "voce";
  let chiave = base, i = 1;
  while (await prisma.qcChecklistItem.findUnique({ where: { tenantId_chiave: { tenantId, chiave } } })) chiave = `${base}_${++i}`;

  const max = await prisma.qcChecklistItem.aggregate({ where: { tenantId }, _max: { ordine: true } });
  const item = await prisma.qcChecklistItem.create({
    data: { tenantId, chiave, etichetta: parsed.data.etichetta, critico: parsed.data.critico, attivo: true, ordine: (max._max.ordine ?? DEFAULT_CHECKLIST.length) + 1 },
  });
  res.status(201).json(item);
}));

// DELETE /api/qc/template/:chiave — rimuove una voce personalizzata
// (le voci di esempio vanno disattivate con PUT, non eliminate).
qcTemplateRouter.delete("/:chiave", requireRole("ADMIN"), wrap(async (req, res) => {
  if (DEFAULT_CHECKLIST.some((d) => d.chiave === req.params.chiave)) {
    return res.status(400).json({ error: "Le voci della checklist di esempio si disattivano, non si eliminano." });
  }
  const { tenantId } = tenantScope(req);
  const { count } = await prisma.qcChecklistItem.deleteMany({ where: { tenantId, chiave: req.params.chiave } });
  if (count === 0) return res.status(404).json({ error: "Voce non trovata" });
  res.status(204).send();
}));

// --- Ispezioni ---

function inspectionSelect() {
  return {
    id: true, vehicleId: true, stato: true, createdAt: true, approvatoAt: true,
    iniziataDa: { select: { nome: true, cognome: true } },
    approvatoDa: { select: { nome: true, cognome: true } },
    checkResults: { orderBy: { createdAt: "asc" } },
    nonConformita: { orderBy: { createdAt: "desc" }, select: {
      id: true, descrizione: true, responsabileId: true, azioneCorrettiva: true, data: true, stato: true,
      checkResultId: true, chiusaAt: true, createdAt: true, fotografiaMime: true,
      responsabile: { select: { nome: true, cognome: true } },
      creataDa: { select: { nome: true, cognome: true } },
    } },
  };
}

// Utile a vehicles.js per decidere se il passaggio a PRONTA_CONSEGNA è permesso.
export async function ultimaIspezioneApprovata(tenantId, vehicleId) {
  const ultima = await prisma.qcInspection.findFirst({ where: { tenantId, vehicleId }, orderBy: { createdAt: "desc" } });
  return ultima?.stato === "APPROVATO";
}

// GET /api/vehicles/:vehicleId/qc — elenco ispezioni del veicolo.
vehicleQcRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const ispezioni = await prisma.qcInspection.findMany({
    where: { vehicleId: req.params.vehicleId, tenantId },
    select: inspectionSelect(),
    orderBy: { createdAt: "desc" },
  });
  res.json(ispezioni);
}));

// POST /api/vehicles/:vehicleId/qc — avvia una nuova ispezione (idempotente:
// se ce n'è già una IN_CORSO la restituisce invece di duplicarla).
vehicleQcRouter.post("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const esistente = await prisma.qcInspection.findFirst({ where: { vehicleId: vehicle.id, tenantId, stato: "IN_CORSO" }, select: inspectionSelect() });
  if (esistente) return res.status(200).json(esistente);

  const voci = await prisma.qcChecklistItem.findMany({ where: { tenantId }, orderBy: { ordine: "asc" } });
  const vociAttive = DEFAULT_CHECKLIST
    .map((def) => voci.find((v) => v.chiave === def.chiave) || { ...def, attivo: true })
    .concat(voci.filter((v) => !DEFAULT_CHECKLIST.some((d) => d.chiave === v.chiave)))
    .filter((v) => v.attivo)
    .sort((a, b) => a.ordine - b.ordine);

  const ispezione = await prisma.$transaction(async (tx) => {
    const created = await tx.qcInspection.create({ data: { tenantId, vehicleId: vehicle.id, iniziataDaId: req.auth.userId } });
    for (const v of vociAttive) {
      await tx.qcCheckResult.create({ data: { tenantId, inspectionId: created.id, chiave: v.chiave, etichetta: v.etichetta, critico: v.critico } });
    }
    await tx.qcEvento.create({ data: { tenantId, inspectionId: created.id, tipo: "ISPEZIONE_AVVIATA", attoreId: req.auth.userId } });
    return tx.qcInspection.findUnique({ where: { id: created.id }, select: inspectionSelect() });
  });
  res.status(201).json(ispezione);
}));

// GET /api/qc/inspections/:id
qcInspectionRouter.get("/:id", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const ispezione = await prisma.qcInspection.findFirst({ where: { id: req.params.id, tenantId }, select: inspectionSelect() });
  if (!ispezione) return res.status(404).json({ error: "Ispezione non trovata" });
  res.json(ispezione);
}));

const esitoSchema = z.object({ esito: z.enum(ESITI).nullable(), note: z.string().max(1000).nullable().optional() });

// PATCH /api/qc/inspections/:id/esiti/:chiave
qcInspectionRouter.patch("/:id/esiti/:chiave", wrap(async (req, res) => {
  const parsed = esitoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const ispezione = await prisma.qcInspection.findFirst({ where: { id: req.params.id, tenantId } });
  if (!ispezione) return res.status(404).json({ error: "Ispezione non trovata" });
  if (ispezione.stato === "APPROVATO") return res.status(400).json({ error: "Questo QC è già stato approvato: non è più modificabile." });

  const risultato = await prisma.qcCheckResult.findUnique({ where: { inspectionId_chiave: { inspectionId: ispezione.id, chiave: req.params.chiave } } });
  if (!risultato) return res.status(404).json({ error: "Voce checklist non trovata in questa ispezione" });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.qcCheckResult.update({
      where: { id: risultato.id },
      data: { esito: parsed.data.esito, note: parsed.data.note, aggiornatoDaId: req.auth.userId, aggiornatoAt: new Date() },
    });
    await tx.qcEvento.create({
      data: { tenantId, inspectionId: ispezione.id, tipo: "ESITO_AGGIORNATO", attoreId: req.auth.userId,
        dettagli: { chiave: risultato.chiave, etichetta: risultato.etichetta, daEsito: risultato.esito, aEsito: parsed.data.esito } },
    });
    return u;
  });
  res.json(updated);
}));

// POST /api/qc/inspections/:id/approva — QC APPROVATO.
qcInspectionRouter.post("/:id/approva", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const ispezione = await prisma.qcInspection.findFirst({
    where: { id: req.params.id, tenantId },
    include: { checkResults: true },
  });
  if (!ispezione) return res.status(404).json({ error: "Ispezione non trovata" });
  if (ispezione.stato === "APPROVATO") return res.status(400).json({ error: "QC già approvato." });

  const bloccanti = vociCriticheBloccanti(ispezione.checkResults);
  const nonValutate = vociNonValutate(ispezione.checkResults);
  if (bloccanti.length > 0) {
    return res.status(409).json({
      error: `Impossibile approvare: ${bloccanti.length} controllo/i critico/i non conforme/i.`,
      vociBloccanti: bloccanti.map((v) => v.etichetta),
    });
  }
  if (nonValutate.length > 0) {
    return res.status(409).json({
      error: `Completa la checklist prima di approvare: ${nonValutate.length} voce/i non ancora valutata/e.`,
      vociDaValutare: nonValutate.map((v) => v.etichetta),
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.qcInspection.update({
      where: { id: ispezione.id },
      data: { stato: "APPROVATO", approvatoDaId: req.auth.userId, approvatoAt: new Date() },
      select: inspectionSelect(),
    });
    await tx.qcEvento.create({ data: { tenantId, inspectionId: ispezione.id, tipo: "QC_APPROVATO", attoreId: req.auth.userId } });
    return u;
  });
  res.json(updated);
}));

// GET /api/qc/inspections/:id/eventi — audit log.
qcInspectionRouter.get("/:id/eventi", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const ispezione = await prisma.qcInspection.findFirst({ where: { id: req.params.id, tenantId } });
  if (!ispezione) return res.status(404).json({ error: "Ispezione non trovata" });
  const eventi = await prisma.qcEvento.findMany({
    where: { inspectionId: ispezione.id, tenantId },
    orderBy: { createdAt: "desc" },
    include: { attore: { select: { nome: true, cognome: true } } },
  });
  res.json(eventi);
}));

// --- Non conformità ---

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const nonConfSchema = z.object({
  descrizione: z.string().min(1).max(2000),
  responsabileId: z.string().optional(),
  azioneCorrettiva: z.string().max(2000).optional(),
  data: z.string().datetime().optional(),
  stato: z.enum(["APERTA", "IN_LAVORAZIONE", "RISOLTA", "CHIUSA"]).optional(),
  checkResultId: z.string().optional(),
});

// POST /api/qc/inspections/:id/non-conformita — multipart: campi sopra + file opzionale.
qcInspectionRouter.post("/:id/non-conformita", upload.single("file"), wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const ispezione = await prisma.qcInspection.findFirst({ where: { id: req.params.id, tenantId } });
  if (!ispezione) return res.status(404).json({ error: "Ispezione non trovata" });

  const parsed = nonConfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.checkResultId) {
    const cr = await prisma.qcCheckResult.findFirst({ where: { id: parsed.data.checkResultId, inspectionId: ispezione.id, tenantId } });
    if (!cr) return res.status(400).json({ error: "Voce checklist collegata non valida per questa ispezione." });
  }
  if (parsed.data.responsabileId) {
    const resp = await prisma.user.findFirst({ where: { id: parsed.data.responsabileId, tenantId, attivo: true } });
    if (!resp) return res.status(400).json({ error: "Responsabile non valido." });
  }

  const nc = await prisma.$transaction(async (tx) => {
    const created = await tx.qcNonConformita.create({
      data: {
        tenantId, inspectionId: ispezione.id, checkResultId: parsed.data.checkResultId || null,
        descrizione: parsed.data.descrizione,
        fotografia: req.file ? req.file.buffer : undefined,
        fotografiaMime: req.file ? req.file.mimetype : undefined,
        fotografiaSize: req.file ? req.file.size : undefined,
        responsabileId: parsed.data.responsabileId || null,
        azioneCorrettiva: parsed.data.azioneCorrettiva || null,
        data: parsed.data.data ? new Date(parsed.data.data) : new Date(),
        stato: parsed.data.stato || "APERTA",
        creataDaId: req.auth.userId,
      },
    });
    await tx.qcEvento.create({
      data: { tenantId, inspectionId: ispezione.id, tipo: "NON_CONFORMITA_APERTA", attoreId: req.auth.userId,
        dettagli: { nonConformitaId: created.id, descrizione: created.descrizione } },
    });
    return created;
  });
  const { fotografia, ...senzaFoto } = nc;
  res.status(201).json(senzaFoto);
}));

// GET /api/qc/inspections/:id/non-conformita
qcInspectionRouter.get("/:id/non-conformita", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const lista = await prisma.qcNonConformita.findMany({
    where: { inspectionId: req.params.id, tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, descrizione: true, responsabileId: true, azioneCorrettiva: true, data: true, stato: true,
      checkResultId: true, chiusaAt: true, createdAt: true, fotografiaMime: true,
      responsabile: { select: { nome: true, cognome: true } },
      creataDa: { select: { nome: true, cognome: true } },
    },
  });
  res.json(lista);
}));

const patchNonConfSchema = z.object({
  descrizione: z.string().min(1).max(2000).optional(),
  responsabileId: z.string().nullable().optional(),
  azioneCorrettiva: z.string().max(2000).nullable().optional(),
  stato: z.enum(["APERTA", "IN_LAVORAZIONE", "RISOLTA", "CHIUSA"]).optional(),
});

// PATCH /api/qc/non-conformita/:id
qcNonConformitaRouter.patch("/:id", wrap(async (req, res) => {
  const parsed = patchNonConfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const existing = await prisma.qcNonConformita.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Non conformità non trovata" });

  const data = { ...parsed.data };
  if (data.stato === "CHIUSA" && existing.stato !== "CHIUSA") data.chiusaAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.qcNonConformita.update({ where: { id: existing.id }, data, select: {
      id: true, descrizione: true, responsabileId: true, azioneCorrettiva: true, data: true, stato: true, chiusaAt: true,
    } });
    await tx.qcEvento.create({
      data: { tenantId, inspectionId: existing.inspectionId, attoreId: req.auth.userId,
        tipo: data.stato === "CHIUSA" ? "NON_CONFORMITA_CHIUSA" : "NON_CONFORMITA_AGGIORNATA",
        dettagli: { nonConformitaId: existing.id, daStato: existing.stato, aStato: data.stato || existing.stato } },
    });
    return u;
  });
  res.json(updated);
}));

// GET /api/qc/non-conformita/:id/fotografia
qcNonConformitaRouter.get("/:id/fotografia", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const nc = await prisma.qcNonConformita.findFirst({ where: { id: req.params.id, tenantId } });
  if (!nc || !nc.fotografia) return res.status(404).json({ error: "Fotografia non disponibile" });
  res.set({ "Content-Type": nc.fotografiaMime || "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }).send(Buffer.from(nc.fotografia));
}));

qcInspectionRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: "File troppo grande: massimo 8 MB" });
  next(err);
});
