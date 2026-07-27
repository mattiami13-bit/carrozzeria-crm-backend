import { Router } from "express";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const quotesRouter = Router();
quotesRouter.use(requireAuth);

quotesRouter.get("/", async (req, res) => {
  const { stato } = req.query;
  const quotes = await prisma.quote.findMany({
    where: { ...tenantScope(req), ...(stato ? { stato: String(stato) } : {}) },
    include: {
      client: { select: { nome: true, cognome: true } },
      vehicle: { select: { marca: true, modello: true, targa: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(quotes);
});

const itemSchema = z.object({
  tipo: z.enum(["MANODOPERA", "RICAMBIO", "VERNICE", "ALTRO"]),
  descrizione: z.string().min(1),
  quantita: z.number().positive().default(1),
  prezzoUnitario: z.number().nonnegative(),
});

const quoteSchema = z.object({
  clientId: z.string(),
  vehicleId: z.string(),
  aliquotaIva: z.number().default(22),
  items: z.array(itemSchema).min(1),
});

// Crea preventivo calcolando imponibile/totale lato server: il totale
// non arriva mai dal client per evitare manipolazioni sul prezzo finale.
quotesRouter.post("/", async (req, res) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { clientId, vehicleId, aliquotaIva, items } = parsed.data;
  const imponibile = items.reduce((sum, i) => sum + i.quantita * i.prezzoUnitario, 0);
  const totale = imponibile * (1 + aliquotaIva / 100);

  const quote = await prisma.quote.create({
    data: {
      ...tenantScope(req),
      clientId,
      vehicleId,
      aliquotaIva,
      imponibile,
      totale,
      items: { create: items },
    },
    include: { items: true },
  });

  res.status(201).json(quote);
});

const statusSchema = z.object({
  stato: z.enum(["BOZZA", "INVIATO", "ACCETTATO", "RIFIUTATO"]),
});

quotesRouter.patch("/:id/stato", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const timestampField =
    parsed.data.stato === "INVIATO" ? { inviatoAt: new Date() } : {};

  const { count } = await prisma.quote.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data: { stato: parsed.data.stato, ...timestampField },
  });
  if (count === 0) return res.status(404).json({ error: "Preventivo non trovato" });

  const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
  res.json(quote);
});

const TIPO_LABEL = {
  MANODOPERA: "Manodopera",
  RICAMBIO: "Ricambio",
  VERNICE: "Vernice",
  ALTRO: "Altro",
};
const STATO_LABEL = {
  BOZZA: "Bozza",
  INVIATO: "Inviato",
  ACCETTATO: "Accettato",
  RIFIUTATO: "Rifiutato",
};
const euro = (n) =>
  Number(n).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

// GET /api/quotes/:id/pdf — genera il PDF al volo (nessun file salvato su
// disco/storage: viene creato in memoria e trasmesso direttamente nella
// risposta HTTP ad ogni richiesta).
quotesRouter.get("/:id/pdf", async (req, res) => {
  const quote = await prisma.quote.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { client: true, vehicle: true, items: true },
  });
  if (!quote) return res.status(404).json({ error: "Preventivo non trovato" });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="preventivo-${quote.vehicle.targa}-${quote.id.slice(-6)}.pdf"`
  );

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  // Intestazione carrozzeria
  doc.fontSize(18).font("Helvetica-Bold").fillColor("#1B1A17").text(tenant.ragioneSociale);
  if (tenant.partitaIva) {
    doc.fontSize(9).font("Helvetica").fillColor("#6B6963").text(`P.IVA ${tenant.partitaIva}`);
  }
  doc.moveDown(1.2);

  // Titolo preventivo
  doc.fontSize(14).font("Helvetica-Bold").fillColor("#E4572E")
    .text(`Preventivo N. ${quote.id.slice(-6).toUpperCase()}`);
  doc.fontSize(9).font("Helvetica").fillColor("#6B6963")
    .text(`Data: ${new Date(quote.createdAt).toLocaleDateString("it-IT")}  ·  Stato: ${STATO_LABEL[quote.stato]}`);
  doc.moveDown(1);

  // Dati cliente e veicolo affiancati
  const startY = doc.y;
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#1B1A17").text("Cliente", 50, startY);
  doc.font("Helvetica").fontSize(9.5).fillColor("#4A4842")
    .text(`${quote.client.nome} ${quote.client.cognome}`, 50, doc.y + 2)
    .text(quote.client.telefono || "-", 50)
    .text(quote.client.email || "-", 50);

  doc.fontSize(10).font("Helvetica-Bold").fillColor("#1B1A17").text("Veicolo", 300, startY);
  doc.font("Helvetica").fontSize(9.5).fillColor("#4A4842")
    .text(`${quote.vehicle.marca} ${quote.vehicle.modello}`, 300, startY + 16)
    .text(`Targa: ${quote.vehicle.targa}`, 300)
    .text(quote.vehicle.vin ? `VIN: ${quote.vehicle.vin}` : "", 300);

  doc.moveDown(2.5);

  // Tabella voci
  const tableTop = doc.y;
  const cols = { descrizione: 50, tipo: 260, qty: 350, prezzo: 400, totale: 470 };
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#fff");
  doc.rect(50, tableTop, 495, 20).fill("#1B1A17");
  doc.fillColor("#fff")
    .text("Descrizione", cols.descrizione + 5, tableTop + 6)
    .text("Tipo", cols.tipo, tableTop + 6)
    .text("Qtà", cols.qty, tableTop + 6)
    .text("Prezzo", cols.prezzo, tableTop + 6)
    .text("Totale", cols.totale, tableTop + 6);

  let y = tableTop + 20;
  doc.font("Helvetica").fontSize(9);
  quote.items.forEach((item, i) => {
    const rowH = 20;
    if (i % 2 === 1) doc.rect(50, y, 495, rowH).fill("#FAF9F6");
    const riga = Number(item.quantita) * Number(item.prezzoUnitario);
    doc.fillColor("#1B1A17")
      .text(item.descrizione, cols.descrizione + 5, y + 6, { width: 200 })
      .text(TIPO_LABEL[item.tipo] || item.tipo, cols.tipo, y + 6)
      .text(String(item.quantita), cols.qty, y + 6)
      .text(euro(item.prezzoUnitario), cols.prezzo, y + 6)
      .text(euro(riga), cols.totale, y + 6);
    y += rowH;
  });

  doc.moveTo(50, y).lineTo(545, y).strokeColor("#E7E4DC").stroke();
  y += 12;

  // Totali
  const totalsX = 380;
  doc.font("Helvetica").fontSize(9.5).fillColor("#4A4842")
    .text("Imponibile", totalsX, y).text(euro(quote.imponibile), 470, y);
  y += 16;
  doc.text(`IVA (${Number(quote.aliquotaIva)}%)`, totalsX, y)
    .text(euro(Number(quote.totale) - Number(quote.imponibile)), 470, y);
  y += 18;
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#E4572E")
    .text("Totale", totalsX, y).text(euro(quote.totale), 470, y);

  doc.end();
});
