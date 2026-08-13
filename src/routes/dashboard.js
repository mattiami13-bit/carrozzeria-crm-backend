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

// GET /api/dashboard/margini-ricambi
// Margine potenziale generato dai ricambi usciti da magazzino (movimenti
// SCARICO). Nota: le voci di preventivo (QuoteItem) non sono collegate
// a un ricambio specifico, quindi il margine non è calcolabile per singola
// commessa/preventivo — questa è una stima aggregata a livello di magazzino,
// basata su prezzoVendita - prezzoAcquisto per unità venduta.
dashboardRouter.get("/margini-ricambi", async (req, res) => {
  const scope = tenantScope(req);

  const parts = await prisma.part.findMany({
    where: scope,
    select: {
      codice: true,
      descrizione: true,
      prezzoAcquisto: true,
      prezzoVendita: true,
      movements: { where: { tipo: "SCARICO" }, select: { quantita: true } },
    },
  });

  const dettaglio = parts
    .filter((p) => p.prezzoVendita != null)
    .map((p) => {
      const quantitaVenduta = p.movements.reduce((sum, m) => sum + m.quantita, 0);
      const margineUnitario = Number(p.prezzoVendita) - Number(p.prezzoAcquisto);
      return {
        codice: p.codice,
        descrizione: p.descrizione,
        quantitaVenduta,
        margineUnitario,
        margineTotale: margineUnitario * quantitaVenduta,
      };
    })
    .filter((p) => p.quantitaVenduta > 0)
    .sort((a, b) => b.margineTotale - a.margineTotale);

  const margineComplessivo = dettaglio.reduce((sum, p) => sum + p.margineTotale, 0);

  res.json({ margineComplessivo, dettaglio });
});

// GET /api/dashboard/tempi-lavorazione
// Tempo medio (in ore) trascorso in ciascuno stage del workflow, calcolato
// dalla cronologia StageHistory: per ogni veicolo, la durata di uno stage
// è la differenza tra il momento in cui vi è entrato e il cambio successivo
// (o "adesso" se il veicolo è ancora in quello stage).
dashboardRouter.get("/tempi-lavorazione", async (req, res) => {
  const scope = tenantScope(req);

  const vehicles = await prisma.vehicle.findMany({
    where: scope,
    select: {
      id: true,
      stageHistory: { orderBy: { changedAt: "asc" }, select: { toStage: true, changedAt: true } },
    },
  });

  const durate = {}; // { STAGE: [oreStadio1, oreStadio2, ...] }
  for (const v of vehicles) {
    const history = v.stageHistory;
    for (let i = 0; i < history.length; i++) {
      const stage = history[i].toStage;
      const inizio = history[i].changedAt;
      const fine = history[i + 1] ? history[i + 1].changedAt : new Date();
      const ore = (fine - inizio) / (1000 * 60 * 60);
      if (!durate[stage]) durate[stage] = [];
      durate[stage].push(ore);
    }
  }

  const medie = Object.entries(durate).map(([stage, valori]) => ({
    stage,
    oreMedie: valori.reduce((a, b) => a + b, 0) / valori.length,
    veicoli: valori.length,
  }));

  res.json(medie);
});

// GET /api/dashboard/utilizzo-ia
// Quante analisi danni IA sono state fatte questo mese e quante ne sono
// incluse nel piano — alimenta l'indicatore in dashboard.
dashboardRouter.get("/utilizzo-ia", async (req, res) => {
  const { tenantId } = tenantScope(req);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  const LIMITE_ANALISI_IA_DEFAULT = { TRIAL: 5, STARTER: 20, PROFESSIONAL: 100, ENTERPRISE: 500 };
  const limite = tenant.limiteAnalisiIAMensile ?? LIMITE_ANALISI_IA_DEFAULT[tenant.piano] ?? 0;

  const inizioMese = new Date();
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);
  const usate = await prisma.aiAnalysisLog.count({
    where: { tenantId, createdAt: { gte: inizioMese } },
  });

  res.json({ usate, limite, piano: tenant.piano });
});

