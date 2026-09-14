import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { validDocument } from "../lib/parts-tracking.js";

// Insurance Gap Analysis: confronto tra il preventivo interno e il
// documento (perizia/preventivo) ricevuto dall'assicurazione. Modulo
// separato, non tocca nessuna route/tabella esistente. Riservato a
// ADMIN/AMMINISTRAZIONE perché confronta importi e prezzi (stessa
// convenzione di Profit Tracker e Parts Tracking).
//
// L'IA propone SOLO una lettura del documento e un confronto voce per
// voce: non dichiara mai una voce "dovuta" o "corretta", e i suggerimenti
// sono sempre presentati come "da verificare professionalmente".

export const insuranceGapRouter = Router({ mergeParams: true });
insuranceGapRouter.use(requireAuth);

export const insuranceGapItemsRouter = Router();
insuranceGapItemsRouter.use(requireAuth);

export const insuranceGapSuggestionsRouter = Router();
insuranceGapSuggestionsRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Il ruolo viene riletto dal database ad ogni richiesta (non solo dal JWT),
// stessa scelta già fatta per Copilot e upload foto: un ruolo cambiato a
// metà sessione non deve continuare a dare accesso a dati finanziari.
const RUOLI_GAP_ASSICURAZIONE = new Set(["ADMIN", "AMMINISTRAZIONE"]);
const requireFinancial = wrap(async (req, res, next) => {
  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.auth.tenantId, attivo: true },
    select: { ruolo: true },
  });
  if (!user) return res.status(403).json({ error: "Account non attivo" });
  if (!RUOLI_GAP_ASSICURAZIONE.has(user.ruolo)) {
    return res.status(403).json({ error: "Funzione riservata ad Admin e Amministrazione." });
  }
  req.auth.role = user.ruolo;
  next();
});
insuranceGapRouter.use(requireFinancial);
insuranceGapItemsRouter.use(requireFinancial);
insuranceGapSuggestionsRouter.use(requireFinancial);

// Stessa quota/piano delle altre analisi IA (foto danni, Copilot): stessa
// risorsa concettuale, un solo contatore mensile per tenant.
const LIMITE_ANALISI_IA_DEFAULT = { TRIAL: 5, STARTER: 20, PROFESSIONAL: 100, ENTERPRISE: 500 };
async function contaAnalisiIAQuestoMese(tenantId) {
  const inizioMese = new Date();
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);
  return prisma.aiAnalysisLog.count({ where: { tenantId, createdAt: { gte: inizioMese } } });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const GAP_STATI = ["CORRISPONDE", "DIFFERENZA", "MANCANTE"];

function analysisSelect() {
  return {
    id: true, vehicleId: true, quoteId: true, sinistroId: true,
    documentName: true, documentMime: true, documentSize: true,
    rispostaGrezza: false,
    totalePreventivoInterno: true, totaleRiconosciutoAssicurazione: true, differenza: true,
    creatoDaId: true, createdAt: true,
    items: { orderBy: { createdAt: "asc" } },
    suggerimenti: { orderBy: { createdAt: "asc" } },
  };
}

// GET /api/vehicles/:vehicleId/insurance-gap
insuranceGapRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const analisi = await prisma.insuranceGapAnalysis.findMany({
    where: { vehicleId: vehicle.id, tenantId },
    select: analysisSelect(),
    orderBy: { createdAt: "desc" },
  });
  res.json(analisi);
}));

// GET /api/vehicles/:vehicleId/insurance-gap/:analysisId/documento
// Restituisce i byte del documento assicurazione originale, mai un link pubblico.
insuranceGapRouter.get("/:analysisId/documento", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const analisi = await prisma.insuranceGapAnalysis.findFirst({
    where: { id: req.params.analysisId, vehicleId: req.params.vehicleId, tenantId },
  });
  if (!analisi) return res.status(404).json({ error: "Documento non disponibile" });
  res.set({
    "Content-Type": analisi.documentMime,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(analisi.documentName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  }).send(Buffer.from(analisi.documentContent));
}));

const analizzaBodySchema = z.object({
  quoteId: z.string().min(1),
  sinistroId: z.string().optional(),
});

// POST /api/vehicles/:vehicleId/insurance-gap/analizza
// multipart/form-data: file (PDF/JPEG/PNG), quoteId, sinistroId opzionale.
insuranceGapRouter.post("/analizza", upload.single("file"), wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);

  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  if (!req.file) return res.status(400).json({ error: "Carica il documento ricevuto dall'assicurazione (PDF, JPEG o PNG)." });
  if (!validDocument(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: "Caricare un PDF, JPEG o PNG valido (massimo 5 MB)." });
  }

  const parsedBody = analizzaBodySchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Seleziona il preventivo interno da confrontare." });

  const quote = await prisma.quote.findFirst({
    where: { id: parsedBody.data.quoteId, tenantId, vehicleId: vehicle.id },
    include: { items: { orderBy: { descrizione: "asc" } } },
  });
  if (!quote) return res.status(404).json({ error: "Preventivo interno non trovato per questo veicolo." });
  if (quote.items.length === 0) return res.status(400).json({ error: "Il preventivo interno selezionato non ha voci da confrontare." });

  let sinistroId = null;
  if (parsedBody.data.sinistroId) {
    const sinistro = await prisma.sinistro.findFirst({ where: { id: parsedBody.data.sinistroId, tenantId, vehicleId: vehicle.id } });
    if (!sinistro) return res.status(404).json({ error: "Sinistro non trovato per questo veicolo." });
    sinistroId = sinistro.id;
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

  const voci = quote.items.map((item, index) => ({
    index,
    tipo: item.tipo,
    descrizione: item.descrizione,
    quantita: Number(item.quantita),
    prezzoUnitario: Number(item.prezzoUnitario),
  }));
  const totalePreventivoInterno = quote.items.reduce((sum, i) => sum + Number(i.quantita) * Number(i.prezzoUnitario), 0);

  const documentBlock = req.file.mimetype === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: req.file.buffer.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: req.file.mimetype, data: req.file.buffer.toString("base64") } };

  const prompt = `Sei un perito esperto di carrozzeria. Il preventivo interno della carrozzeria per questo veicolo (${vehicle.marca} ${vehicle.modello}, targa ${vehicle.targa}) ha queste voci:
${JSON.stringify(voci, null, 0)}

Allegato trovi il documento (preventivo o perizia) ricevuto dalla compagnia assicurativa. Confronta OGNI voce del preventivo interno con il documento assicurazione e determina se è stata riconosciuta.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza backtick, con questa struttura esatta:
{
  "totaleRiconosciutoAssicurazione": numero in euro (totale indicato nel documento assicurazione, oppure somma delle voci trovate se il totale non è indicato; null se il documento non è leggibile),
  "voci": [
    { "index": indice della voce del preventivo interno (stesso indice fornito sopra, uno per ogni voce, nello stesso ordine),
      "trovato": true o false,
      "descrizioneAssicurazione": "come è descritta nel documento assicurazione, oppure null se non trovata",
      "quantitaAssicurazione": numero o null,
      "prezzoUnitarioAssicurazione": numero o null,
      "stato": "CORRISPONDE" oppure "DIFFERENZA" oppure "MANCANTE" }
  ],
  "suggerimenti": [
    { "voce": "nome di un elemento comune per questo tipo di intervento, non presente né nel preventivo interno né (presumibilmente) nel documento assicurazione", "motivo": "breve spiegazione di perché potrebbe essere rilevante" }
  ]
}

Regole obbligatorie:
- Includi un elemento in "voci" per OGNI indice del preventivo interno fornito sopra, nello stesso ordine, nessuno escluso.
- "CORRISPONDE" solo se la voce è presente nel documento assicurazione con importo di riga (quantità × prezzo) entro il 5% o 5 euro (il maggiore) rispetto al preventivo interno.
- "DIFFERENZA" se la voce è presente ma con quantità, prezzo o importo diverso oltre quella soglia.
- "MANCANTE" se la voce NON è presente nel documento assicurazione.
- "suggerimenti": al massimo 6 elementi, solo cose plausibili e comuni per questo tipo di lavorazione (es. smontaggio/rimontaggio componenti, sfumatura, materiali di consumo, calibrazione ADAS, primer, opacizzazione) che non risultano né nel preventivo interno né nel documento assicurazione.
- NON dichiarare MAI che una voce (né dei "suggerimenti" né altro) è dovuta, corretta o da fatturare: sono sempre e solo spunti da verificare professionalmente dall'operatore, mai conclusioni definitive.
- Non inventare importi o descrizioni: se il documento non è leggibile in una parte, usa null per quel campo invece di stimarlo.`;

  let aiResult;
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
        messages: [{ role: "user", content: [documentBlock, { type: "text", text: prompt }] }],
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error("Errore Anthropic API (insurance-gap):", data);
      return res.status(502).json({ error: "Errore nella chiamata al servizio IA. Controlla la chiave ANTHROPIC_API_KEY su Railway." });
    }
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return res.status(502).json({ error: "Risposta IA senza testo utilizzabile." });
    rawText = textBlock.text;
    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    aiResult = JSON.parse(cleaned);
  } catch (e) {
    console.error("Errore Insurance Gap Analysis IA:", e);
    return res.status(502).json({ error: "Impossibile leggere il documento. Verifica che sia un PDF o un'immagine leggibile e riprova." });
  }

  const vociAI = Array.isArray(aiResult?.voci) ? aiResult.voci : [];
  const suggerimentiAI = Array.isArray(aiResult?.suggerimenti) ? aiResult.suggerimenti.slice(0, 6) : [];
  const totaleRiconosciuto = Number.isFinite(aiResult?.totaleRiconosciutoAssicurazione) ? aiResult.totaleRiconosciutoAssicurazione : null;

  const analisi = await prisma.$transaction(async (tx) => {
    const created = await tx.insuranceGapAnalysis.create({
      data: {
        tenantId,
        vehicleId: vehicle.id,
        quoteId: quote.id,
        sinistroId,
        documentName: req.file.originalname.slice(0, 200),
        documentMime: req.file.mimetype,
        documentSize: req.file.size,
        documentContent: req.file.buffer,
        rispostaGrezza: { testo: rawText },
        totalePreventivoInterno,
        totaleRiconosciutoAssicurazione: totaleRiconosciuto,
        differenza: totaleRiconosciuto != null ? totalePreventivoInterno - totaleRiconosciuto : null,
        creatoDaId: req.auth.userId,
      },
    });

    for (let index = 0; index < quote.items.length; index++) {
      const item = quote.items[index];
      const trovata = vociAI.find((v) => v?.index === index);
      const stato = GAP_STATI.includes(trovata?.stato) ? trovata.stato : "MANCANTE";
      const quantitaAssicurazioneAI = Number.isFinite(trovata?.quantitaAssicurazione) ? trovata.quantitaAssicurazione : null;
      const prezzoUnitarioAssicurazioneAI = Number.isFinite(trovata?.prezzoUnitarioAssicurazione) ? trovata.prezzoUnitarioAssicurazione : null;
      await tx.insuranceGapItem.create({
        data: {
          tenantId,
          analysisId: created.id,
          quoteItemId: item.id,
          descrizione: item.descrizione,
          tipo: item.tipo,
          quantita: item.quantita,
          prezzoUnitario: item.prezzoUnitario,
          trovatoAI: Boolean(trovata?.trovato),
          descrizioneAssicurazioneAI: trovata?.descrizioneAssicurazione ? String(trovata.descrizioneAssicurazione) : null,
          quantitaAssicurazioneAI,
          prezzoUnitarioAssicurazioneAI,
          statoAI: stato,
          quantitaAssicurazione: quantitaAssicurazioneAI,
          prezzoUnitarioAssicurazione: prezzoUnitarioAssicurazioneAI,
          stato,
        },
      });
    }

    for (const s of suggerimentiAI) {
      if (!s?.voce) continue;
      await tx.insuranceGapSuggestion.create({
        data: { tenantId, analysisId: created.id, voce: String(s.voce).slice(0, 200), motivo: String(s.motivo || "").slice(0, 500) },
      });
    }

    await tx.aiAnalysisLog.create({ data: { tenantId, vehicleId: vehicle.id } });

    return tx.insuranceGapAnalysis.findUnique({ where: { id: created.id }, select: analysisSelect() });
  });

  res.status(201).json(analisi);
}));

// DELETE /api/vehicles/:vehicleId/insurance-gap/:analysisId
insuranceGapRouter.delete("/:analysisId", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const analisi = await prisma.insuranceGapAnalysis.findFirst({
    where: { id: req.params.analysisId, vehicleId: req.params.vehicleId, tenantId },
  });
  if (!analisi) return res.status(404).json({ error: "Analisi non trovata" });

  await prisma.$transaction([
    prisma.insuranceGapItem.deleteMany({ where: { analysisId: analisi.id, tenantId } }),
    prisma.insuranceGapSuggestion.deleteMany({ where: { analysisId: analisi.id, tenantId } }),
    prisma.insuranceGapAnalysis.delete({ where: { id: analisi.id } }),
  ]);
  res.status(204).send();
}));

const STATO_COLORE = { CORRISPONDE: "#2F8F5B", DIFFERENZA: "#C9A24B", MANCANTE: "#B4472E" };
const STATO_LABEL = { CORRISPONDE: "Corrisponde", DIFFERENZA: "Differenza", MANCANTE: "Voce mancante" };
const euro = (n) => Number(n ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const richiestaBodySchema = z.object({
  itemIds: z.array(z.string()).optional(),
  suggestionIds: z.array(z.string()).optional(),
});

// POST /api/vehicles/:vehicleId/insurance-gap/:analysisId/richiesta-integrazione
// Genera una BOZZA PDF (mai inviata automaticamente) con le voci in
// differenza/mancanti selezionate e gli eventuali suggerimenti scelti
// dall'operatore, da controllare prima di inviarla all'assicurazione.
insuranceGapRouter.post("/:analysisId/richiesta-integrazione", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const parsedBody = richiestaBodySchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: "Richiesta non valida." });

  const analisi = await prisma.insuranceGapAnalysis.findFirst({
    where: { id: req.params.analysisId, vehicleId: req.params.vehicleId, tenantId },
    include: {
      vehicle: { include: { client: true } },
      quote: true,
      sinistro: true,
      items: { where: { stato: { in: ["DIFFERENZA", "MANCANTE"] } }, orderBy: { createdAt: "asc" } },
      suggerimenti: { where: { scartata: false }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!analisi) return res.status(404).json({ error: "Analisi non trovata" });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  const itemsSelezionati = parsedBody.data.itemIds?.length
    ? analisi.items.filter((i) => parsedBody.data.itemIds.includes(i.id))
    : analisi.items;
  const suggerimentiSelezionati = parsedBody.data.suggestionIds?.length
    ? analisi.suggerimenti.filter((s) => parsedBody.data.suggestionIds.includes(s.id))
    : analisi.suggerimenti;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="richiesta-integrazione-${analisi.vehicle.targa}-${analisi.id.slice(-6)}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  doc.fontSize(9).font("Helvetica-Bold").fillColor("#B4472E").text("BOZZA — DA VERIFICARE PRIMA DELL'INVIO", { align: "right" });
  doc.moveDown(0.3);
  doc.fontSize(18).font("Helvetica-Bold").fillColor("#1B1A17").text(tenant.ragioneSociale);
  if (tenant.partitaIva) doc.fontSize(9).font("Helvetica").fillColor("#6B6963").text(`P.IVA ${tenant.partitaIva}`);
  doc.moveDown(1);

  doc.fontSize(14).font("Helvetica-Bold").fillColor("#E4572E").text("Richiesta di integrazione — voci da verificare");
  doc.fontSize(9).font("Helvetica").fillColor("#6B6963")
    .text(`Data: ${new Date().toLocaleDateString("it-IT")}  ·  Rif. analisi: ${analisi.id.slice(-6).toUpperCase()}`);
  doc.moveDown(1);

  const startY = doc.y;
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#1B1A17").text("Veicolo", 50, startY);
  doc.font("Helvetica").fontSize(9.5).fillColor("#4A4842")
    .text(`${analisi.vehicle.marca} ${analisi.vehicle.modello}`, 50, doc.y + 2)
    .text(`Targa: ${analisi.vehicle.targa}`, 50)
    .text(`Cliente: ${analisi.vehicle.client?.nome ?? ""} ${analisi.vehicle.client?.cognome ?? ""}`, 50);

  doc.fontSize(10).font("Helvetica-Bold").fillColor("#1B1A17").text("Sinistro", 300, startY);
  doc.font("Helvetica").fontSize(9.5).fillColor("#4A4842")
    .text(analisi.sinistro?.numeroPratica ? `N. pratica: ${analisi.sinistro.numeroPratica}` : "N. pratica: non indicato", 300, startY + 16)
    .text(`Compagnia: ${analisi.sinistro?.compagniaAssicurativa ?? "non indicata"}`, 300)
    .text(`Perito: ${analisi.sinistro?.perito ?? "non indicato"}`, 300);

  doc.moveDown(2.5);

  doc.font("Helvetica").fontSize(9.5).fillColor("#4A4842")
    .text(`Preventivo carrozzeria: ${euro(analisi.totalePreventivoInterno)}`)
    .text(`Riconosciuto assicurazione: ${analisi.totaleRiconosciutoAssicurazione != null ? euro(analisi.totaleRiconosciutoAssicurazione) : "non indicato"}`)
    .font("Helvetica-Bold").fillColor("#B4472E")
    .text(`Differenza: ${analisi.differenza != null ? euro(analisi.differenza) : "non calcolabile"}`);
  doc.moveDown(1.2);

  if (itemsSelezionati.length > 0) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1B1A17").text("Voci da verificare");
    doc.moveDown(0.3);
    for (const item of itemsSelezionati) {
      const nostro = Number(item.quantita) * Number(item.prezzoUnitario);
      const loro = item.quantitaAssicurazione != null && item.prezzoUnitarioAssicurazione != null
        ? Number(item.quantitaAssicurazione) * Number(item.prezzoUnitarioAssicurazione)
        : null;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(STATO_COLORE[item.stato] || "#1B1A17")
        .text(`${STATO_LABEL[item.stato] || item.stato} — ${item.descrizione}`, { continued: false });
      doc.font("Helvetica").fontSize(9).fillColor("#4A4842")
        .text(`Preventivo carrozzeria: ${item.quantita} × ${euro(item.prezzoUnitario)} = ${euro(nostro)}`);
      doc.text(loro != null
        ? `Riconosciuto assicurazione: ${item.quantitaAssicurazione} × ${euro(item.prezzoUnitarioAssicurazione)} = ${euro(loro)}${item.descrizioneAssicurazioneAI ? ` (indicato come "${item.descrizioneAssicurazioneAI}")` : ""}`
        : "Non risulta riconosciuta nel documento assicurazione.");
      if (item.noteOperatore) doc.font("Helvetica-Oblique").text(`Nota operatore: ${item.noteOperatore}`);
      doc.moveDown(0.6);
    }
  }

  if (suggerimentiSelezionati.length > 0) {
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1B1A17").text("Possibili voci da verificare professionalmente");
    doc.font("Helvetica").fontSize(9).fillColor("#4A4842")
      .text("Elementi comuni per questo tipo di intervento, non confermati come dovuti: da valutare con il perito.");
    doc.moveDown(0.3);
    for (const s of suggerimentiSelezionati) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#1B1A17").text(`• ${s.voce}`);
      if (s.motivo) doc.font("Helvetica").fontSize(9).fillColor("#4A4842").text(s.motivo);
      doc.moveDown(0.4);
    }
  }

  doc.moveDown(1);
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#8D9099")
    .text("Documento generato automaticamente da un'analisi IA di supporto: le voci elencate sono da verificare professionalmente prima dell'invio alla compagnia assicurativa. Nessuna voce è stata dichiarata dovuta o corretta in automatico.");

  doc.end();
}));

const correzioneSchema = z.object({
  quantitaAssicurazione: z.number().nonnegative().nullable().optional(),
  prezzoUnitarioAssicurazione: z.number().nonnegative().nullable().optional(),
  stato: z.enum(GAP_STATI).optional(),
  noteOperatore: z.string().nullable().optional(),
});

// PATCH /api/insurance-gap-items/:id
insuranceGapItemsRouter.patch("/:id", wrap(async (req, res) => {
  const parsed = correzioneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const existing = await prisma.insuranceGapItem.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Voce non trovata" });

  const updated = await prisma.insuranceGapItem.update({
    where: { id: existing.id },
    data: { ...parsed.data, modificatoManualmente: true, modificatoDaId: req.auth.userId, modificatoAt: new Date() },
  });
  res.json(updated);
}));

// PATCH /api/insurance-gap-suggestions/:id  { scartata: true|false }
insuranceGapSuggestionsRouter.patch("/:id", wrap(async (req, res) => {
  const parsed = z.object({ scartata: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valore non valido" });

  const { tenantId } = tenantScope(req);
  const { count } = await prisma.insuranceGapSuggestion.updateMany({
    where: { id: req.params.id, tenantId },
    data: { scartata: parsed.data.scartata },
  });
  if (count === 0) return res.status(404).json({ error: "Suggerimento non trovato" });
  res.status(204).send();
}));
