import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const supplierOrdersRouter = Router();
supplierOrdersRouter.use(requireAuth);

// GET /api/supplier-orders
// Elenco ordini, opzionalmente filtrati per stato.
supplierOrdersRouter.get("/", async (req, res) => {
  const { stato } = req.query;
  const orders = await prisma.supplierOrder.findMany({
    where: { ...tenantScope(req), ...(stato ? { stato: String(stato) } : {}) },
    include: { items: true },
    orderBy: { dataOrdine: "desc" },
  });
  res.json(orders);
});

supplierOrdersRouter.get("/:id", async (req, res) => {
  const order = await prisma.supplierOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { items: true },
  });
  if (!order) return res.status(404).json({ error: "Ordine non trovato" });
  res.json(order);
});

const itemSchema = z.object({
  partId: z.string().optional(),
  descrizione: z.string().min(1),
  quantitaOrdinata: z.number().int().positive(),
  prezzoUnitario: z.number().nonnegative().optional(),
});

const orderSchema = z.object({
  fornitore: z.string().min(1),
  dataConsegnaPrevista: z.string().datetime().optional(),
  note: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

supplierOrdersRouter.post("/", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { fornitore, dataConsegnaPrevista, note, items } = parsed.data;
  const order = await prisma.supplierOrder.create({
    data: {
      ...tenantScope(req),
      fornitore,
      note,
      ...(dataConsegnaPrevista ? { dataConsegnaPrevista: new Date(dataConsegnaPrevista) } : {}),
      items: { create: items },
    },
    include: { items: true },
  });

  res.status(201).json(order);
});

const statusSchema = z.object({
  stato: z.enum(["IN_ATTESA", "PARZIALE", "CONSEGNATO"]),
});

supplierOrdersRouter.patch("/:id/stato", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { count } = await prisma.supplierOrder.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data: { stato: parsed.data.stato },
  });
  if (count === 0) return res.status(404).json({ error: "Ordine non trovato" });

  const order = await prisma.supplierOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
  res.json(order);
});

// Registra la quantità ricevuta per una singola voce d'ordine. Se
// tutte le voci risultano ricevute integralmente, l'ordine passa
// automaticamente a CONSEGNATO; se solo alcune, a PARZIALE. Se il
// ricambio ricevuto è collegato a un articolo del magazzino (partId),
// la giacenza viene aggiornata e viene registrato un movimento di
// carico, così il ricevimento merce alimenta automaticamente lo
// stock senza bisogno di un secondo passaggio manuale.
supplierOrdersRouter.patch("/:id/items/:itemId/ricevi", async (req, res) => {
  const schema = z.object({ quantitaRicevuta: z.number().int().nonnegative() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.supplierOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { items: true },
  });
  if (!order) return res.status(404).json({ error: "Ordine non trovato" });

  const item = order.items.find((i) => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: "Voce d'ordine non trovata" });

  const nuovaQuantita = parsed.data.quantitaRicevuta;
  const deltaRicevuto = nuovaQuantita - item.quantitaRicevuta;

  const operations = [
    prisma.supplierOrderItem.update({
      where: { id: item.id },
      data: { quantitaRicevuta: nuovaQuantita },
    }),
  ];

  if (item.partId && deltaRicevuto !== 0) {
    operations.push(
      prisma.part.update({
        where: { id: item.partId },
        data: { giacenza: { increment: deltaRicevuto } },
      })
    );
    if (deltaRicevuto > 0) {
      operations.push(
        prisma.partMovement.create({
          data: { partId: item.partId, tipo: "CARICO", quantita: deltaRicevuto },
        })
      );
    }
  }

  await prisma.$transaction(operations);

  const updatedItems = order.items.map((i) => (i.id === item.id ? { ...i, quantitaRicevuta: nuovaQuantita } : i));
  const tutteRicevute = updatedItems.every((i) => i.quantitaRicevuta >= i.quantitaOrdinata);
  const parzialiRicevute = updatedItems.some((i) => i.quantitaRicevuta > 0);
  const nuovoStato = tutteRicevute ? "CONSEGNATO" : parzialiRicevute ? "PARZIALE" : "IN_ATTESA";

  const updatedOrder = await prisma.supplierOrder.update({
    where: { id: order.id },
    data: { stato: nuovoStato },
    include: { items: true },
  });

  res.json(updatedOrder);
});

supplierOrdersRouter.delete("/:id", async (req, res) => {
  const { count } = await prisma.supplierOrder.deleteMany({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (count === 0) return res.status(404).json({ error: "Ordine non trovato" });
  res.status(204).end();
});
