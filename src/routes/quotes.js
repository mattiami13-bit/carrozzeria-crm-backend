import { Router } from "express";
import { z } from "zod";
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
