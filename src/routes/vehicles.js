import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { enqueueNotification } from "../lib/notifiche.js";

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
    orderBy: { updatedAt: "desc" },
  });
  res.json(vehicles);
});

vehiclesRouter.get("/:id", async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      client: true,
      tecnico: true,
      photos: { orderBy: { createdAt: "asc" } },
      quotes: true,
      stageHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { nome: true, cognome: true } } } },
    },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
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

  const vehicle = await prisma.vehicle.create({
    data: {
      ...parsed.data,
      ...tenantScope(req),
      dataPrevistaConsegna: parsed.data.dataPrevistaConsegna
        ? new Date(parsed.data.dataPrevistaConsegna)
        : undefined,
    },
  });

  // Prima riga di cronologia: l'accettazione stessa.
  await prisma.stageHistory.create({
    data: { vehicleId: vehicle.id, toStage: "ACCETTAZIONE", changedById: req.auth.userId },
  });

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

    const updated = await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.update({

  
      where: { id: current.id },
      data: {
        stage: parsed.data.stage,
        dataConsegnaEffettiva: parsed.data.stage === "CONSEGNATA" ? new Date() : undefined,
      },
      include: { client: true },
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

  await enqueueNotification(updated, parsed.data.stage);

  res.json(updated);
});

vehiclesRouter.patch("/:id", async (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

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
// vince sempre sul default del piano (utile per accordi personalizzati).
const LIMITE_ANALISI_IA_DEFAULT = {
  TRIAL: 5,
  STARTER: 20,
  PROFESSIONAL: 100,
  ENTERPRISE: 500,
};

async function contaAnalisiIAQuestoMese(tenantId) {
  const inizioMese = new Date();
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);
  return prisma.aiAnalysisLog.count({
    where: { tenantId, createdAt: { gte: inizioMese } },
  });
}

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
      photos: { where: { fase: "PRIMA" }, orderBy: { createdAt: "asc" }, take: 6 },
    },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
  if (vehicle.photos.length === 0) {
    return res.status(400).json({ error: 'Carica almeno una foto "Prima" del veicolo prima di avviare l\'analisi.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurata su Railway." });
  }

  // Controllo quota mensile del piano.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const limite = tenant.limiteAnalisiIAMensile ?? LIMITE_ANALISI_IA_DEFAULT[tenant.piano] ?? 0;
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
      const imgRes = await fetch(photo.url);
      if (!imgRes.ok) continue;
      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: contentType, data: buffer.toString("base64") },
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
      return res.status(502).json({ error: "Errore nella chiamata al servizio IA. Controlla la chiave ANTHROPIC_API_KEY su Railway." });
    }
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
      include: { client: true, tecnico: true, photos: { orderBy: { createdAt: "asc" } }, quotes: true },
    }),
    prisma.aiAnalysisLog.create({
      data: { tenantId, vehicleId: vehicle.id },
    }),
  ]);

  res.json(updated);
});

