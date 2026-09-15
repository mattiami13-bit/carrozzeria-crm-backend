import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { creaNotificaRuoli } from "../lib/notificheInApp.js";
import { readPhotoImage } from "../lib/photo-timeline-service.js";

// AI Damage Assistant: modulo nuovo e separato dalla vecchia "Stima danni
// IA" (Vehicle.stimaIA, vedi vehicles.js POST /:id/analizza-danni), che
// resta invariata. Qui ogni danno è una riga strutturata a sé (DamageItem),
// pensata per diventare direttamente una voce di preventivo — sempre con
// conferma/modifica umana obbligatoria prima di generare la bozza.

export const damageAssistantRouter = Router({ mergeParams: true });
damageAssistantRouter.use(requireAuth);

export const damageItemsRouter = Router();
damageItemsRouter.use(requireAuth);

const GRAVITA_VALUES = ["LIEVE", "MEDIA", "GRAVE"];
const TIPO_VOCE_VALUES = ["MANODOPERA", "RICAMBIO", "VERNICE", "ALTRO"];

// Stessa quota/piano della vecchia "Stima danni IA": è la stessa risorsa
// (analisi foto via IA), quindi condivide il contatore AiAnalysisLog e il
// campo Tenant.limiteAnalisiIAMensile invece di introdurne uno nuovo.
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
  return prisma.aiAnalysisLog.count({ where: { tenantId, createdAt: { gte: inizioMese } } });
}

const voceSchema = z.object({
  tipo: z.enum(TIPO_VOCE_VALUES),
  descrizione: z.string().min(1),
  quantita: z.number().positive(),
  prezzoUnitario: z.number().nonnegative(),
});

// GET /api/vehicles/:vehicleId/damage-assistant
// Elenco delle sessioni di analisi (con i relativi danni) per il veicolo.
damageAssistantRouter.get("/", async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const analisi = await prisma.damageAnalysis.findMany({
    where: { vehicleId: vehicle.id, tenantId },
    include: { items: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(analisi);
});

const analizzaSchema = z.object({ photoIds: z.array(z.string()).min(1).max(10) });

// POST /api/vehicles/:vehicleId/damage-assistant/analizza
// body: { photoIds: string[] } — foto già caricate sul veicolo da analizzare.
damageAssistantRouter.post("/analizza", async (req, res) => {
  const { tenantId } = tenantScope(req);

  const parsed = analizzaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Seleziona almeno una foto da analizzare (massimo 10)." });
  }

  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const photos = await prisma.photo.findMany({
    where: { id: { in: parsed.data.photoIds }, vehicleId: vehicle.id },
  });
  if (photos.length === 0) {
    return res.status(400).json({ error: "Nessuna delle foto indicate appartiene a questo veicolo." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurata su Railway." });
  }

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
  for (const photo of photos) {
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
    return res.status(400).json({ error: "Nessuna delle foto selezionate è risultata scaricabile per l'analisi." });
  }

  const prompt = `Sei un perito esperto di carrozzeria che usa l'"AI Damage Assistant" di un gestionale per carrozzerie. Analizza le foto allegate di un veicolo danneggiato (${vehicle.marca} ${vehicle.modello}, targa ${vehicle.targa}) e individua OGNI singolo danno visibile separatamente, uno per riga.
Rispondi SOLO con un array JSON valido, senza testo prima o dopo e senza backtick. Se non individui nessun danno chiaro, rispondi con []. Ogni elemento dell'array rappresenta UN danno, con questa struttura esatta:
{
  "parte": "es. Portiera anteriore sinistra",
  "posizione": "es. anteriore sinistra",
  "tipologiaDanno": "es. Ammaccatura, Graffio profondo, Crepa",
  "gravita": "LIEVE" | "MEDIA" | "GRAVE",
  "lavorazioneSuggerita": "es. riparazione + preparazione + verniciatura, oppure valutare sostituzione",
  "necessitaSostituzione": true | false,
  "confidenzaPercento": numero intero da 0 a 100 (quanto sei sicuro di questo rilevamento),
  "vociPreventivo": [
    { "tipo": "MANODOPERA" | "RICAMBIO" | "VERNICE" | "ALTRO", "descrizione": "...", "quantita": numero, "prezzoUnitario": numero in euro (stima indicativa, mercato carrozzerie italiano) }
  ]
}
Questa è solo una prima valutazione automatica di supporto: l'operatore la rivede e corregge sempre prima di trasformarla in preventivo definitivo. Sii prudente e realistico nei prezzi; se un'area non è chiaramente visibile, abbassa la confidenza invece di inventare dettagli.`;

  let items = [];
  let rawText = "";
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
        max_tokens: 3000,
        messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error("Errore Anthropic API (damage-assistant):", data);
      return res.status(502).json({ error: "Errore nella chiamata al servizio IA. Controlla la chiave ANTHROPIC_API_KEY su Railway." });
    }
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return res.status(502).json({ error: "Risposta IA senza testo utilizzabile." });
    rawText = textBlock.text;
    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    const parsedItems = JSON.parse(cleaned);
    items = Array.isArray(parsedItems) ? parsedItems : [];
  } catch (e) {
    console.error("Errore AI Damage Assistant:", e);
    return res.status(502).json({ error: "Impossibile completare l'analisi IA. Riprova." });
  }

  const analysis = await prisma.$transaction(async (tx) => {
    const created = await tx.damageAnalysis.create({
      data: {
        tenantId,
        vehicleId: vehicle.id,
        creatoDaId: req.auth.userId,
        photoIds: photos.map((p) => p.id),
        rispostaGrezza: { testo: rawText },
      },
    });

    for (const it of items) {
      const gravita = GRAVITA_VALUES.includes(it?.gravita) ? it.gravita : "MEDIA";
      const vociPreventivoGrezze = Array.isArray(it?.vociPreventivo) ? it.vociPreventivo : [];
      const vociPreventivo = vociPreventivoGrezze
        .filter((v) => v && TIPO_VOCE_VALUES.includes(v.tipo) && v.descrizione)
        .map((v) => ({
          tipo: v.tipo,
          descrizione: String(v.descrizione),
          quantita: Number(v.quantita) > 0 ? Number(v.quantita) : 1,
          prezzoUnitario: Number(v.prezzoUnitario) >= 0 ? Number(v.prezzoUnitario) : 0,
        }));
      const confidenza = Number.isFinite(it?.confidenzaPercento)
        ? Math.max(0, Math.min(100, Math.round(it.confidenzaPercento)))
        : null;

      await tx.damageItem.create({
        data: {
          tenantId,
          damageAnalysisId: created.id,
          parteAI: String(it?.parte || "Non specificato"),
          posizioneAI: it?.posizione ? String(it.posizione) : null,
          tipologiaDannoAI: String(it?.tipologiaDanno || "Non specificato"),
          gravitaAI: gravita,
          lavorazioneAI: it?.lavorazioneSuggerita ? String(it.lavorazioneSuggerita) : null,
          necessitaSostituzioneAI: Boolean(it?.necessitaSostituzione),
          confidenzaPercento: confidenza,
          vociPreventivoAI: vociPreventivo,
          parte: String(it?.parte || "Non specificato"),
          posizione: it?.posizione ? String(it.posizione) : null,
          tipologiaDanno: String(it?.tipologiaDanno || "Non specificato"),
          gravita,
          lavorazioneSuggerita: it?.lavorazioneSuggerita ? String(it.lavorazioneSuggerita) : null,
          necessitaSostituzione: Boolean(it?.necessitaSostituzione),
          vociPreventivo,
        },
      });
    }

    await tx.aiAnalysisLog.create({ data: { tenantId, vehicleId: vehicle.id } });

    return tx.damageAnalysis.findUnique({ where: { id: created.id }, include: { items: { orderBy: { createdAt: "asc" } } } });
  });

  creaNotificaRuoli({
    tenantId,
    ruoli: ["ADMIN", "AMMINISTRAZIONE"],
    categoria: "AI",
    titolo: "Analisi danni AI completata",
    messaggio: `L'AI Damage Assistant ha rilevato ${analysis.items.length} danno/i su ${vehicle.marca} ${vehicle.modello} (targa ${vehicle.targa}), da rivedere e confermare.`,
    link: { tab: "veicoli", vehicleId: vehicle.id },
    escludiUserId: req.auth.userId,
  }).catch((err) => console.error("[notifiche] Errore creazione notifica analisi danni AI:", err.message));

  res.status(201).json(analysis);
});

const bozzaSchema = z.object({ damageItemIds: z.array(z.string()).min(1) });

// POST /api/vehicles/:vehicleId/damage-assistant/bozza-preventivo
// Converte i danni selezionati (con le eventuali correzioni dell'operatore)
// in un preventivo BOZZA vero e proprio, riusando le stesse regole di
// calcolo di POST /api/quotes. Resta sempre una bozza: nulla viene inviato
// o accettato automaticamente, l'operatore deve rivederla e inviarla lui.
damageAssistantRouter.post("/bozza-preventivo", async (req, res) => {
  const { tenantId } = tenantScope(req);

  const parsed = bozzaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Seleziona almeno un danno da includere nel preventivo." });
  }

  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const damageItems = await prisma.damageItem.findMany({
    where: { id: { in: parsed.data.damageItemIds }, tenantId, damageAnalysis: { vehicleId: vehicle.id } },
  });
  if (damageItems.length === 0) {
    return res.status(400).json({ error: "Nessuno dei danni indicati è valido per questo veicolo." });
  }

  const items = [];
  for (const di of damageItems) {
    const voci = Array.isArray(di.vociPreventivo) && di.vociPreventivo.length > 0
      ? di.vociPreventivo
      : [{ tipo: "MANODOPERA", descrizione: `${di.parte} — ${di.tipologiaDanno}`, quantita: 1, prezzoUnitario: 0 }];
    for (const v of voci) {
      const parsedVoce = voceSchema.safeParse(v);
      if (parsedVoce.success) items.push(parsedVoce.data);
    }
  }
  if (items.length === 0) {
    return res.status(400).json({ error: "I danni selezionati non hanno voci di preventivo valide." });
  }

  const aliquotaIva = 22;
  const imponibile = items.reduce((sum, i) => sum + i.quantita * i.prezzoUnitario, 0);
  const totale = imponibile * (1 + aliquotaIva / 100);

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.quote.create({
      data: {
        tenantId,
        clientId: vehicle.clientId,
        vehicleId: vehicle.id,
        aliquotaIva,
        imponibile,
        totale,
        items: { create: items },
      },
      include: { items: true },
    });
    await tx.damageItem.updateMany({
      where: { id: { in: damageItems.map((d) => d.id) } },
      data: { quoteId: created.id },
    });
    return created;
  });

  res.status(201).json(quote);
});

const correzioneSchema = z.object({
  parte: z.string().min(1).optional(),
  posizione: z.string().nullable().optional(),
  tipologiaDanno: z.string().min(1).optional(),
  gravita: z.enum(GRAVITA_VALUES).optional(),
  lavorazioneSuggerita: z.string().nullable().optional(),
  necessitaSostituzione: z.boolean().optional(),
  noteOperatore: z.string().nullable().optional(),
  vociPreventivo: z.array(voceSchema).optional(),
});

// PATCH /api/damage-items/:id
// Correzione manuale dell'operatore: i campi "*AI" originali non vengono
// mai toccati, solo questi campi correnti. Serve anche a marcare l'item
// come "modificatoManualmente" per un futuro confronto AI vs correzioni.
damageItemsRouter.patch("/:id", async (req, res) => {
  const parsed = correzioneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const existing = await prisma.damageItem.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Danno non trovato" });

  const updated = await prisma.damageItem.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      modificatoManualmente: true,
      modificatoDaId: req.auth.userId,
      modificatoAt: new Date(),
    },
  });
  res.json(updated);
});

// DELETE /api/damage-items/:id
// L'operatore scarta un rilevamento sbagliato (falso positivo): non finisce
// mai nella bozza di preventivo. Il DamageAnalysis originale resta intatto
// per storico/debug, si cancella solo la singola riga.
damageItemsRouter.delete("/:id", async (req, res) => {
  const { tenantId } = tenantScope(req);
  const { count } = await prisma.damageItem.deleteMany({ where: { id: req.params.id, tenantId } });
  if (count === 0) return res.status(404).json({ error: "Danno non trovato" });
  res.status(204).send();
});
