import { publicPhoto, legacyPhotoSelect, signPhotos } from '../lib/photo-timeline.js';
import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { inviaLinkPortale } from "../lib/notifiche.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { STAGE_ORDER } from "./vehicles.js";

// Portale cliente: accesso pubblico senza username/password, tramite un
// token lungo (32 byte, non indovinabile) incluso in un link personale
// inviato al cliente. Il token è l'UNICA credenziale: ogni route pubblica
// qui sotto deve filtrare sempre per token -> veicolo, mai per id nudo,
// così un token valido può raggiungere solo i dati della propria pratica.

export const portaleRouter = Router();
// Staff (autenticato), montati sotto /api/vehicles/:vehicleId/... —
// stessa convenzione già usata da Insurance Gap Analysis e WhatsApp.
export const portalDocumentsRouter = Router({ mergeParams: true });
portalDocumentsRouter.use(requireAuth);
export const portalActionsRouter = Router({ mergeParams: true });
portalActionsRouter.use(requireAuth);
// Staff (autenticato), item singolo per id, montati sotto /api/portal-documents e /api/portal-actions.
export const portalDocumentItemRouter = Router();
portalDocumentItemRouter.use(requireAuth);
export const portalActionItemRouter = Router();
portalActionItemRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const GIORNI_SCADENZA_TOKEN = 180;

// --- Rate limiting in-process (nessuna dipendenza esterna: sufficiente per
// una singola istanza Railway). Protegge da tentativi ripetuti di indovinare
// un token o da abusi delle azioni scrivibili del portale. ---
function rateLimiter(maxPerMinute) {
  const finestre = new Map();
  return (req, res, next) => {
    const chiave = req.ip || "sconosciuto";
    const ora = Date.now();
    const voce = finestre.get(chiave);
    if (!voce || ora - voce.inizio > 60_000) {
      finestre.set(chiave, { inizio: ora, conteggio: 1 });
      return next();
    }
    voce.conteggio++;
    if (voce.conteggio > maxPerMinute) {
      return res.status(429).json({ error: "Troppe richieste, riprova tra qualche minuto." });
    }
    next();
  };
}
const limitatoreLettura = rateLimiter(60);
const limitatoreScrittura = rateLimiter(20);

function scadenzaDefault() {
  return new Date(Date.now() + GIORNI_SCADENZA_TOKEN * 24 * 60 * 60 * 1000);
}

// STAFF (autenticato): genera — o riusa se già esiste — il link di
// accesso pubblico per un veicolo. Il token non viene mai rigenerato
// se ne esiste già uno attivo, per non invalidare link già inviati.
portaleRouter.post("/genera/:vehicleId", requireAuth, wrap(async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.vehicleId, ...tenantScope(req) },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  let access = await prisma.portalAccess.findFirst({
    where: { vehicleId: vehicle.id, attivo: true },
  });

  let appenaCreato = false;
  if (!access) {
    const token = crypto.randomBytes(32).toString("hex");
    access = await prisma.portalAccess.create({
      data: { tenantId: req.auth.tenantId, vehicleId: vehicle.id, token, scadenza: scadenzaDefault() },
    });
    appenaCreato = true;
  }

  if (appenaCreato) {
    const vehicleConCliente = await prisma.vehicle.findUnique({
      where: { id: vehicle.id },
      include: { client: true },
    });
    const link = `${req.protocol}://${req.get("host")}/portale/?t=${access.token}`;
    inviaLinkPortale(vehicleConCliente, link); // non blocca la risposta: invio in background
  }

  res.status(201).json({ token: access.token, scadenza: access.scadenza });
}));

// STAFF (autenticato): revoca il link corrente — es. su richiesta del
// cliente o per errore nell'invio — invalidando subito il token.
portaleRouter.post("/revoca/:vehicleId", requireAuth, wrap(async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, ...tenantScope(req) } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  await prisma.portalAccess.updateMany({
    where: { vehicleId: vehicle.id, tenantId: req.auth.tenantId, attivo: true },
    data: { attivo: false },
  });
  res.status(204).send();
}));

// Risolve un token in un PortalAccess valido (attivo e non scaduto),
// oppure null. Usata da tutte le route pubbliche sotto: stessa identica
// verifica ovunque, per non lasciare un varco in una singola route.
async function accessoValido(token) {
  const access = await prisma.portalAccess.findUnique({ where: { token } });
  if (!access || !access.attivo) return null;
  if (access.scadenza && access.scadenza < new Date()) return null;
  return access;
}

function numeroPraticaDi(vehicle) {
  const sinistro = Array.isArray(vehicle.sinistri) ? vehicle.sinistri[0] : null;
  return sinistro?.numeroPratica || vehicle.id.slice(-8).toUpperCase();
}

// Stato grafico del workflow per il cliente: ✓ fatto, 🟠 in corso, ○ da fare.
const STAGE_LABEL_CLIENTE = {
  ACCETTAZIONE: "Accettazione", PREVENTIVO: "Preventivo", ATTESA_APPROVAZIONE: "Approvazione preventivo",
  ORDINE_RICAMBI: "Ordine ricambi", IN_LAVORAZIONE: "Lavorazione", PREPARAZIONE: "Preparazione",
  VERNICIATURA: "Verniciatura", LUCIDATURA: "Lucidatura", CONTROLLO_QUALITA: "Controllo qualità",
  LAVAGGIO: "Lavaggio", PRONTA_CONSEGNA: "Pronta per il ritiro", CONSEGNATA: "Consegnata",
};
function workflowDi(stage) {
  const indiceAttuale = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER.map((s, i) => ({
    stage: s,
    label: STAGE_LABEL_CLIENTE[s] || s,
    stato: i < indiceAttuale ? "FATTO" : i === indiceAttuale ? "IN_CORSO" : "DA_FARE",
  }));
}

// CLIENTE (pubblico, nessun login): consulta lo stato della propria
// pratica tramite il token ricevuto via email/WhatsApp. Nessuna lista,
// nessun altro dato del tenant è raggiungibile da qui — mai note interne,
// costi o marginalità: solo i campi esplicitamente selezionati qui sotto.
portaleRouter.get("/:token", limitatoreLettura, wrap(async (req, res) => {
  const access = await accessoValido(req.params.token);
  if (!access) return res.status(404).json({ error: "Link non valido o scaduto" });

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: access.vehicleId },
    include: {
      client: { select: { nome: true, cognome: true } },
      photos: { where: { visibilePortale: true }, select: legacyPhotoSelect, orderBy: { createdAt: "asc" } },
      stageHistory: { orderBy: { changedAt: "asc" } },
      quotes: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, stato: true, totale: true, inviatoAt: true,
          firmatarioNome: true, firmatoAt: true, createdAt: true,
          items: { select: { descrizione: true, quantita: true, prezzoUnitario: true } },
        },
      },
      sinistri: { select: { numeroPratica: true, stato: true, compagniaAssicurativa: true } },
      portalDocuments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, nome: true, mime: true, size: true, richiedeFirma: true, firmatarioNome: true, firmatoAt: true, createdAt: true },
      },
    },
  });

  await prisma.portalAccess.update({
    where: { id: access.id },
    data: { ultimoAccessoAt: new Date(), numeroAccessi: { increment: 1 } },
  });

  res.json({
    veicolo: {
      marca: vehicle.marca, modello: vehicle.modello, targa: vehicle.targa,
      stage: vehicle.stage, dataPrevistaConsegna: vehicle.dataPrevistaConsegna,
    },
    numeroPratica: numeroPraticaDi(vehicle),
    cliente: vehicle.client,
    workflow: workflowDi(vehicle.stage),
    foto: (await signPhotos(vehicle.photos, access.tenantId)).map(publicPhoto),
    storicoStage: vehicle.stageHistory,
    preventivi: vehicle.quotes.map((q, i) => ({ ...q, tipo: i === 0 ? "PREVENTIVO" : "INTEGRAZIONE" })),
    documenti: vehicle.portalDocuments,
    sinistro: vehicle.sinistri[0] ?? null,
  });
}));

async function registraAzione(access, tipo, extra = {}, ip = null) {
  return prisma.portalAction.create({
    data: { tenantId: access.tenantId, vehicleId: access.vehicleId, portalAccessId: access.id, tipo, ip, ...extra },
  });
}

// CLIENTE (pubblico): approva/firma un preventivo (iniziale o
// integrazione) legato ESATTAMENTE al veicolo di questo token — impedisce
// di firmare preventivi di altri veicoli anche riusando un token valido
// ma diverso.
portaleRouter.post("/:token/preventivi/:quoteId/firma", limitatoreScrittura, wrap(async (req, res) => {
  const { firmaDataUrl, firmatarioNome } = req.body || {};
  if (!firmaDataUrl || !firmatarioNome) return res.status(400).json({ error: "Firma o nome mancante." });

  const access = await accessoValido(req.params.token);
  if (!access) return res.status(404).json({ error: "Link non valido o scaduto" });

  const quotes = await prisma.quote.findMany({
    where: { vehicleId: access.vehicleId, tenantId: access.tenantId },
    orderBy: { createdAt: "asc" },
  });
  const indice = quotes.findIndex((q) => q.id === req.params.quoteId);
  if (indice === -1) return res.status(404).json({ error: "Preventivo non trovato per questa pratica." });
  const quote = quotes[indice];
  if (quote.stato !== "INVIATO") return res.status(400).json({ error: "Questo preventivo non è firmabile in questo momento." });

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: { firmaDataUrl, firmatarioNome, firmatoAt: new Date(), stato: "ACCETTATO" },
  });

  await registraAzione(
    access,
    indice === 0 ? "APPROVAZIONE_PREVENTIVO" : "APPROVAZIONE_INTEGRAZIONE",
    { messaggio: `Preventivo ${quote.id} — € ${quote.totale}` },
    req.ip,
  );

  res.json(updated);
}));

// CLIENTE (pubblico): scarica un documento condiviso per la propria
// pratica (mai un URL pubblico diretto: sempre uno stream autenticato dal
// token, stesso principio già usato per i documenti assicurazione).
portaleRouter.get("/:token/documenti/:id/scarica", limitatoreLettura, wrap(async (req, res) => {
  const access = await accessoValido(req.params.token);
  if (!access) return res.status(404).json({ error: "Link non valido o scaduto" });

  const doc = await prisma.portalDocument.findFirst({
    where: { id: req.params.id, vehicleId: access.vehicleId, tenantId: access.tenantId },
  });
  if (!doc) return res.status(404).json({ error: "Documento non disponibile" });

  res.set({
    "Content-Type": doc.mime,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.nome)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  }).send(Buffer.from(doc.content));
}));

// CLIENTE (pubblico): firma un documento che lo richiede.
portaleRouter.post("/:token/documenti/:id/firma", limitatoreScrittura, wrap(async (req, res) => {
  const { firmaDataUrl, firmatarioNome } = req.body || {};
  if (!firmaDataUrl || !firmatarioNome) return res.status(400).json({ error: "Firma o nome mancante." });

  const access = await accessoValido(req.params.token);
  if (!access) return res.status(404).json({ error: "Link non valido o scaduto" });

  const doc = await prisma.portalDocument.findFirst({
    where: { id: req.params.id, vehicleId: access.vehicleId, tenantId: access.tenantId },
  });
  if (!doc) return res.status(404).json({ error: "Documento non disponibile" });
  if (!doc.richiedeFirma) return res.status(400).json({ error: "Questo documento non richiede firma." });
  if (doc.firmatoAt) return res.status(400).json({ error: "Documento già firmato." });

  const updated = await prisma.portalDocument.update({
    where: { id: doc.id },
    data: { firmaDataUrl, firmatarioNome, firmatoAt: new Date() },
    select: { id: true, nome: true, richiedeFirma: true, firmatarioNome: true, firmatoAt: true },
  });

  await registraAzione(access, "FIRMA_DOCUMENTO", { messaggio: `Documento: ${doc.nome}` }, req.ip);

  res.json(updated);
}));

const contattaSchema = z.object({ messaggio: z.string().min(1).max(1000) });

// CLIENTE (pubblico): invia un messaggio allo staff della carrozzeria.
portaleRouter.post("/:token/contatta", limitatoreScrittura, wrap(async (req, res) => {
  const parsed = contattaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Scrivi un messaggio." });

  const access = await accessoValido(req.params.token);
  if (!access) return res.status(404).json({ error: "Link non valido o scaduto" });

  await registraAzione(access, "RICHIESTA_CONTATTO", { messaggio: parsed.data.messaggio }, req.ip);
  res.status(201).json({ ok: true });
}));

const prenotaSchema = z.object({ dataRichiesta: z.string().datetime(), messaggio: z.string().max(500).optional() });

// CLIENTE (pubblico): prenota una data/ora indicativa di ritiro veicolo.
portaleRouter.post("/:token/prenota-ritiro", limitatoreScrittura, wrap(async (req, res) => {
  const parsed = prenotaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Indica una data valida per il ritiro." });

  const access = await accessoValido(req.params.token);
  if (!access) return res.status(404).json({ error: "Link non valido o scaduto" });

  await registraAzione(access, "RICHIESTA_RITIRO", {
    dataRichiesta: new Date(parsed.data.dataRichiesta),
    messaggio: parsed.data.messaggio || null,
  }, req.ip);
  res.status(201).json({ ok: true });
}));

// --- STAFF (autenticato): documenti e richieste del cliente ---

const uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/vehicles/:vehicleId/portal-documents — carica un documento da
// condividere col cliente (multipart: file, richiedeFirma).
portalDocumentsRouter.post("/", uploadDoc.single("file"), wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
  if (!req.file) return res.status(400).json({ error: "Nessun file caricato" });

  const doc = await prisma.portalDocument.create({
    data: {
      tenantId, vehicleId: vehicle.id,
      nome: req.file.originalname.slice(0, 200), mime: req.file.mimetype, size: req.file.size,
      content: req.file.buffer,
      richiedeFirma: req.body.richiedeFirma === "true" || req.body.richiedeFirma === true,
      caricatoDaId: req.auth.userId,
    },
    select: { id: true, nome: true, mime: true, size: true, richiedeFirma: true, firmatarioNome: true, firmatoAt: true, createdAt: true },
  });
  res.status(201).json(doc);
}));
portalDocumentsRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: "File troppo grande: massimo 10 MB" });
  next(err);
});

// GET /api/vehicles/:vehicleId/portal-documents — elenco (staff).
portalDocumentsRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const docs = await prisma.portalDocument.findMany({
    where: { vehicleId: req.params.vehicleId, tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, nome: true, mime: true, size: true, richiedeFirma: true, firmatarioNome: true, firmatoAt: true, createdAt: true },
  });
  res.json(docs);
}));

// DELETE /api/portal-documents/:id — rimuove un documento non più utile.
portalDocumentItemRouter.delete("/:id", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const { count } = await prisma.portalDocument.deleteMany({ where: { id: req.params.id, tenantId } });
  if (count === 0) return res.status(404).json({ error: "Documento non trovato" });
  res.status(204).send();
}));

// GET /api/vehicles/:vehicleId/portal-actions — richieste/azioni del
// cliente per questa pratica (staff, per gestire contatti e ritiri).
portalActionsRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const azioni = await prisma.portalAction.findMany({
    where: { vehicleId: req.params.vehicleId, tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(azioni);
}));

// PATCH /api/portal-actions/:id — segna una richiesta come gestita.
portalActionItemRouter.patch("/:id", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const { count } = await prisma.portalAction.updateMany({
    where: { id: req.params.id, tenantId },
    data: { gestita: true, gestitaDaId: req.auth.userId, gestitaAt: new Date() },
  });
  if (count === 0) return res.status(404).json({ error: "Azione non trovata" });
  res.status(204).send();
}));
