import { legacyPhotoSelect, signPhotos } from '../lib/photo-timeline.js';
import { readPhotoImage } from '../lib/photo-timeline-service.js';
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { enqueueNotification } from "../lib/notifiche.js";
import { inviaComunicazioneWhatsapp } from "../lib/whatsapp.js";
import { ultimaIspezioneApprovata } from "./qc.js";
import { limiteAnalisiIA, contaAnalisiIAQuestoMese, segnalaUsoAnalisiIA } from "../lib/aiUsage.js";
import { registraCostoAi } from "../lib/aiCost.js";

export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth);

export const STAGE_ORDER = [
  "ACCETTAZIONE",
  "PREVENTIVO",
  "ATTESA_APPROVAZIONE",
  "ORDINE_RICAMBI",
  "IN_LAVORAZIONE",
  "PREPARAZIONE",
  "VERNICIATURA",
  "LUCIDATURA",
  "CONTROLLO_QUALITA",
  "LAVAGGIO",
  "PRONTA_CONSEGNA",
  "CONSEGNATA",
];

// GET /api/vehicles?stage=VERNICIATURA&search=FG471RB
// Restituisce l'elenco usato sia dalla board (raggruppato per stage
// lato client) sia dalla ricerca globale per targa.
vehiclesRouter.get("/", async (req, res) => {
  const { stage, search } = req.query;
  const vehicles = await prisma.vehicle.findMany({
    where: {
      ...tenantScope(req),
      ...(stage ? { stage: String(stage) } : {}),
      ...(search
        ? {
            OR: [
              { targa: { contains: String(search), mode: "insensitive" } },
              { vin: { contains: String(search), mode: "insensitive" } },
              { numeroSinistro: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      client: { select: { nome: true, cognome: true, telefono: true } },
      tecnico: { select: { nome: true, cognome: true } },
      _count: { select: { photos: true } },
    },
    // Vista elenco/board: stimaIA (JSON IA) e firmaConsegnaDataUrl (firma
    // come data URL base64) sono dati da vista dettaglio, mai usati qui
    // (verificato: VehicleDetailModal fa la sua chiamata separata a
    // GET /api/vehicles/:id, che li restituisce) — su un elenco di molti
    // veicoli pesano inutilmente sulla risposta.
    omit: { stimaIA: true, firmaConsegnaDataUrl: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json(vehicles);
});

vehiclesRouter.get("/:id", async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      client: true,
      // Mai l'utente intero: includerebbe passwordHash nella risposta.
      tecnico: { select: { id: true, nome: true, cognome: true, ruolo: true } },
      photos: { select:legacyPhotoSelect, orderBy: { createdAt: "asc" } },
      quotes: true,
      stageHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { nome: true, cognome: true } } } },
    },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
  vehicle.photos = await signPhotos(vehicle.photos, req.auth.tenantId);
  res.json(vehicle);
});

const vehicleSchema = z.object({
  clientId: z.string(),
  marca: z.string().min(1),
  modello: z.string().min(1),
  targa: z.string().min(1),
  vin: z.string().optional(),
  colore: z.string().optional(),
  km: z.number().int().optional(),
  compagniaAssicurativa: z.string().optional(),
  numeroSinistro: z.string().optional(),
  perito: z.string().optional(),
  tecnicoId: z.string().optional(),
  dataPrevistaConsegna: z.string().datetime().optional(),
});

vehiclesRouter.post("/", async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // clientId/tecnicoId arrivano dal client: verificare che appartengano
  // allo stesso tenant, altrimenti si potrebbe agganciare un veicolo al
  // cliente (o assegnarlo al tecnico) di un'altra organizzazione.
  const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, ...tenantScope(req) } });
  if (!client) return res.status(400).json({ error: "Cliente non valido" });
  if (parsed.data.tecnicoId) {
    const tecnico = await prisma.user.findFirst({ where: { id: parsed.data.tecnicoId, ...tenantScope(req) } });
    if (!tecnico) return res.status(400).json({ error: "Tecnico non valido" });
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      ...parsed.data,
      ...tenantScope(req),
      dataPrevistaConsegna: parsed.data.dataPrevistaConsegna
        ? new Date(parsed.data.dataPrevistaConsegna)
        : undefined,
    },
    include: { client: true, sinistri: true },
  });

  // Prima riga di cronologia: l'accettazione stessa.
  await prisma.stageHistory.create({
    data: { vehicleId: vehicle.id, toStage: "ACCETTAZIONE", changedById: req.auth.userId },
  });

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  await inviaComunicazioneWhatsapp(vehicle, "ACCETTAZIONE", baseUrl, req.auth.userId);

  res.status(201).json(vehicle);
});

const stageSchema = z.object({
  stage: z.enum(STAGE_ORDER),
});

// PATCH /api/vehicles/:id/stage
// Cambio stato: aggiorna il veicolo e scrive una riga di cronologia
// immutabile. Da qui si agganciano in futuro le notifiche WhatsApp
// automatiche (es. su transizione verso VERNICIATURA -> "in verniciatura",
// PRONTA_CONSEGNA -> "la sua auto è pronta").
vehiclesRouter.patch("/:id/stage", async (req, res) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const current = await prisma.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { client: true },
  });
  if (!current) return res.status(404).json({ error: "Veicolo non trovato" });

  // Quality Control obbligatorio: non si passa a "Pronta" senza un'ispezione
  // QC approvata (nessun controllo critico non conforme, checklist completa).
  if (parsed.data.stage === "PRONTA_CONSEGNA" && current.stage !== "PRONTA_CONSEGNA") {
    const approvato = await ultimaIspezioneApprovata(req.auth.tenantId, current.id);
    if (!approvato) {
      return res.status(409).json({
        error: "Prima di passare a \"Pronta\" serve completare e approvare il Controllo Qualità (QC) di questa pratica.",
        qcRichiesto: true,
      });
    }
  }

    const updated = await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.update({


      where: { id: current.id },
      data: {
        stage: parsed.data.stage,
        dataConsegnaEffettiva: parsed.data.stage === "CONSEGNATA" ? new Date() : undefined,
      },
      include: { client: true, sinistri: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    await tx.stageHistory.create({
      data: {
        vehicleId: vehicle.id,
        fromStage: current.stage,
        toStage: parsed.data.stage,
        changedById: req.auth.userId,
      },
    });
    return vehicle;
  });

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  await enqueueNotification(updated, parsed.data.stage, baseUrl);
  await inviaComunicazioneWhatsapp(updated, parsed.data.stage, baseUrl, req.auth.userId);

  res.json(updated);
});

vehiclesRouter.patch("/:id", async (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.clientId) {
    const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, ...tenantScope(req) } });
    if (!client) return res.status(400).json({ error: "Cliente non valido" });
  }
  if (parsed.data.tecnicoId) {
    const tecnico = await prisma.user.findFirst({ where: { id: parsed.data.tecnicoId, ...tenantScope(req) } });
    if (!tecnico) return res.status(400).json({ error: "Tecnico non valido" });
  }

  const { count } = await prisma.vehicle.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data: {
      ...parsed.data,
      dataPrevistaConsegna: parsed.data.dataPrevistaConsegna
        ? new Date(parsed.data.dataPrevistaConsegna)
        : undefined,
    },
  });
  if (count === 0) return res.status(404).json({ error: "Veicolo non trovato" });

  const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
  res.json(vehicle);
});

// Analisi danni IA: limiti mensili inclusi per piano di abbonamento.
// Se un tenant ha "limiteAnalisiIAMensile" impostato manualmente, quello
// vince sempre sul default del piano (utile per accordi personalizzati) —
// vedi lib/aiUsage.js (punto 40) per la fonte unica di questi limiti.

// POST /api/vehicles/:id/analizza-danni
// Analizza le foto "PRIMA" del veicolo con Claude (Anthropic) per generare
// una stima preliminare di danni e costo. Richiede la variabile d'ambiente
// ANTHROPIC_API_KEY su Railway. È solo un supporto: la stima finale resta
// sempre a carico del perito/titolare — il prompt lo ricorda esplicitamente
// al modello e il risultato include sempre delle "note al perito".
//
// Prima di chiamare l'IA, controlla che il tenant non abbia superato il
// numero di analisi incluse nel proprio piano questo mese.
vehiclesRouter.post("/:id/analizza-danni", async (req, res) => {
  const { tenantId } = tenantScope(req);

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      photos: { select:legacyPhotoSelect, where: { fase: "PRIMA" }, orderBy: { createdAt: "asc" }, take: 6 },
    },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
  if (vehicle.photos.length === 0) {
    return res.status(400).json({ error: 'Carica almeno una foto "Prima" del veicolo prima di avviare l\'analisi.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY mancante: funzione AI richiesta ma non configurata.");
    return res.status(500).json({ error: "Funzione AI non disponibile al momento. Riprova più tardi o contatta l'assistenza." });
  }

  // Controllo quota mensile del piano.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const limite = limiteAnalisiIA(tenant);
  const usate = await contaAnalisiIAQuestoMese(tenantId);
  if (usate >= limite) {
    return res.status(429).json({
      error: `Hai raggiunto il limite di ${limite} analisi IA incluse nel tuo piano questo mese (${usate} usate). Contattaci per un upgrade del piano.`,
    });
  }

  // Scarica le foto e le converte in base64 per l'API vision di Claude.
  const imageBlocks = [];
  for (const photo of vehicle.photos) {
    try {
      const buffer = await readPhotoImage(photo, tenantId);
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: buffer.toString("base64") },
      });
    } catch (e) {
      // Foto non raggiungibile: la saltiamo, non blocchiamo l'intera analisi.
    }
  }

  if (imageBlocks.length === 0) {
    return res.status(400).json({ error: "Nessuna delle foto è risultata scaricabile per l'analisi." });
  }

  const prompt = `Sei un perito esperto di carrozzeria. Analizza le foto allegate di un veicolo danneggiato (${vehicle.marca} ${vehicle.modello}, targa ${vehicle.targa}) e fornisci una stima preliminare.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza backtick, con questa struttura esatta:
{
  "severita": "lieve" | "moderata" | "grave",
  "areeDanneggiate": ["..."],
  "descrizione": "descrizione dei danni visibili in 2-4 frasi",
  "costoStimatoMin": numero in euro,
  "costoStimatoMax": numero in euro,
  "noteAlPerito": "eventuali dubbi, aree da verificare di persona, limiti della stima fotografica"
}
Sii prudente: è una stima preliminare da foto, non una perizia definitiva. Se le foto non permettono una valutazione affidabile, dillo chiaramente in noteAlPerito e allarga la fascia di costo.`;

  let aiResult;
  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error("Errore Anthropic API:", data);
      return res.status(502).json({ error: "Errore nella chiamata al servizio IA. Riprova più tardi o contatta l'assistenza." });
    }
    registraCostoAi({ tenantId, funzione: "STIMA_DANNI_LEGACY", model: "claude-sonnet-5", usage: data.usage }).catch(() => {});
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return res.status(502).json({ error: "Risposta IA senza testo utilizzabile." });

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    aiResult = JSON.parse(cleaned);
  } catch (e) {
    console.error("Errore analisi IA:", e);
    return res.status(502).json({ error: "Impossibile completare l'analisi IA. Riprova." });
  }

  const [updated] = await prisma.$transaction([
    prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { stimaIA: aiResult, stimaIAAt: new Date() },
      include: { client: true, tecnico: { select: { id: true, nome: true, cognome: true, ruolo: true } }, photos: { select:legacyPhotoSelect, orderBy: { createdAt: "asc" } }, quotes: true },
    }),
    prisma.aiAnalysisLog.create({
      data: { tenantId, vehicleId: vehicle.id },
    }),
  ]);

  segnalaUsoAnalisiIA(tenant, usate + 1).catch(() => {});

  updated.photos = await signPhotos(updated.photos, tenantId);
  res.json(updated);
});

const firmaConsegnaSchema = z.object({
  firmaDataUrl: z.string().min(1),
  firmatarioNome: z.string().min(1),
});

// POST /api/vehicles/:id/firma-consegna
// Registra la firma di ritiro del cliente: salva l'immagine della firma
// e il nome di chi firma, e porta il veicolo allo stadio CONSEGNATA con
// la stessa logica della PATCH /:id/stage (cronologia + notifica) —
// firmare la consegna *è* consegnare il veicolo, sono lo stesso gesto.
vehiclesRouter.post("/:id/firma-consegna", async (req, res) => {
  const parsed = firmaConsegnaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Firma o nome mancante." });

  const current = await prisma.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { client: true },
  });
  if (!current) return res.status(404).json({ error: "Veicolo non trovato" });

  const updated = await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.update({
      where: { id: current.id },
      data: {
        stage: "CONSEGNATA",
        dataConsegnaEffettiva: new Date(),
        firmaConsegnaDataUrl: parsed.data.firmaDataUrl,
        firmatarioConsegna: parsed.data.firmatarioNome,
        dataFirmaConsegna: new Date(),
      },
      include: { client: true, sinistri: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    await tx.stageHistory.create({
      data: {
        vehicleId: vehicle.id,
        fromStage: current.stage,
        toStage: "CONSEGNATA",
        changedById: req.auth.userId,
      },
    });
    return vehicle;
  });

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  await enqueueNotification(updated, "CONSEGNATA", baseUrl);
  await inviaComunicazioneWhatsapp(updated, "CONSEGNATA", baseUrl, req.auth.userId);

  res.json(updated);
});


