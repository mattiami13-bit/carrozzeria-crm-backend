import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// GET /api/dashboard/summary
// Un'unica chiamata che alimenta le card della dashboard, per evitare
// che il frontend debba fare 8 richieste separate a ogni caricamento.
dashboardRouter.get("/summary", async (req, res) => {
  const scope = tenantScope(req);

  const [inOfficina, prontaConsegna, attesaRicambi, preventiviInviati, preventiviAccettati, quotesAccettati] =
    await Promise.all([
      prisma.vehicle.count({ where: { ...scope, NOT: { stage: "CONSEGNATA" } } }),
      prisma.vehicle.count({ where: { ...scope, stage: "PRONTA_CONSEGNA" } }),
      prisma.vehicle.count({ where: { ...scope, stage: "ORDINE_RICAMBI" } }),
      prisma.quote.count({ where: { ...scope, stato: "INVIATO" } }),
      prisma.quote.count({ where: { ...scope, stato: "ACCETTATO" } }),
      prisma.quote.findMany({ where: { ...scope, stato: "ACCETTATO" }, select: { totale: true } }),
    ]);

  const fatturatoStimato = quotesAccettati.reduce((sum, q) => sum + Number(q.totale), 0);
  const ticketMedio = quotesAccettati.length > 0 ? fatturatoStimato / quotesAccettati.length : 0;

  res.json({
    inOfficina,
    prontaConsegna,
    attesaRicambi,
    preventiviInviati,
    preventiviAccettati,
    fatturatoStimato,
    ticketMedio,
  });
});

// GET /api/dashboard/fatturato-mensile
// Fatturato basato sui preventivi ACCETTATO raggruppati per mese,
// ultimi 6 mesi. Da sostituire con le fatture reali quando il modulo
// di fatturazione elettronica sarà collegato.
dashboardRouter.get("/fatturato-mensile", async (req, res) => {
  const scope = tenantScope(req);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const quotes = await prisma.quote.findMany({
    where: { ...scope, stato: "ACCETTATO", updatedAt: { gte: sixMonthsAgo } },
    select: { totale: true, updatedAt: true },
  });

  const perMese = {};
  for (const q of quotes) {
    const key = `${q.updatedAt.getFullYear()}-${String(q.updatedAt.getMonth() + 1).padStart(2, "0")}`;
    perMese[key] = (perMese[key] ?? 0) + Number(q.totale);
  }

  res.json(
    Object.entries(perMese)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mese, totale]) => ({ mese, totale }))
  );
});
