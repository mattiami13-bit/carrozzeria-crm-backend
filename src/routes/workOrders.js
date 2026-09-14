import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { oreReali, aggregaKpi, REPARTI } from "../lib/work-orders.js";

// Modalità Tecnico: lavorazioni assegnate ("I miei lavori"), tracciamento
// ore con Inizia/Pausa/Termina, correzioni manuali autorizzate e KPI non
// punitivi per tecnico/reparto. Modulo additivo: non tocca nessuna route
// o tabella esistente (il vecchio, mai usato, model TimeEntry resta
// intatto e separato — qui si usa solo il nuovo WorkOrderTimeEntry).

export const vehicleWorkOrdersRouter = Router({ mergeParams: true });
vehicleWorkOrdersRouter.use(requireAuth);

export const workOrdersRouter = Router();
workOrdersRouter.use(requireAuth);

export const workOrderTimeEntriesRouter = Router();
workOrderTimeEntriesRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const woSelect = {
  id: true, vehicleId: true, tecnicoId: true, titolo: true, reparto: true, priorita: true,
  oreStimate: true, noteTecniche: true, dataConsegna: true, stato: true, createdAt: true, updatedAt: true,
  tecnico: { select: { id: true, nome: true, cognome: true } },
  vehicle: { select: { marca: true, modello: true, targa: true, stage: true } },
  timeEntries: { orderBy: { inizio: "asc" } },
};

function conOreReali(wo) {
  return { ...wo, oreReali: Number(oreReali(wo.timeEntries || []).toFixed(2)) };
}

const workOrderSchema = z.object({
  tecnicoId: z.string().min(1),
  titolo: z.string().min(1).max(200),
  reparto: z.enum(REPARTI),
  priorita: z.enum(["BASSA", "NORMALE", "ALTA", "URGENTE"]).optional(),
  oreStimate: z.number().positive().max(500),
  noteTecniche: z.string().max(2000).optional(),
  dataConsegna: z.string().datetime().optional(),
});

// POST /api/vehicles/:vehicleId/work-orders — crea una lavorazione (staff).
vehicleWorkOrdersRouter.post("/", wrap(async (req, res) => {
  const parsed = workOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const tecnico = await prisma.user.findFirst({ where: { id: parsed.data.tecnicoId, tenantId, attivo: true } });
  if (!tecnico) return res.status(400).json({ error: "Tecnico non valido" });

  const wo = await prisma.$transaction(async (tx) => {
    const created = await tx.workOrder.create({
      data: {
        tenantId, vehicleId: vehicle.id,
        tecnicoId: parsed.data.tecnicoId, titolo: parsed.data.titolo, reparto: parsed.data.reparto,
        priorita: parsed.data.priorita || "NORMALE", oreStimate: parsed.data.oreStimate,
        noteTecniche: parsed.data.noteTecniche || null,
        dataConsegna: parsed.data.dataConsegna ? new Date(parsed.data.dataConsegna) : null,
        creatoDaId: req.auth.userId,
      },
    });
    await tx.workOrderEvento.create({ data: { tenantId, workOrderId: created.id, tipo: "CREATA", aStato: "DA_INIZIARE", attoreId: req.auth.userId } });
    return tx.workOrder.findUnique({ where: { id: created.id }, select: woSelect });
  });
  res.status(201).json(conOreReali(wo));
}));

// GET /api/vehicles/:vehicleId/work-orders — elenco per la scheda veicolo (staff).
vehicleWorkOrdersRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
  const orders = await prisma.workOrder.findMany({
    where: { vehicleId: req.params.vehicleId, tenantId },
    select: woSelect,
    orderBy: { createdAt: "desc" },
  });
  res.json(orders.map(conOreReali));
}));

// Mappa reparto -> chiave usata dal Profit Tracker (src/lib/profit.js CATEGORIES)
// e dal Predictive Delay AI (src/lib/delay.js DEPARTMENTS), per mostrare le
// ore realmente tracciate come riferimento affiancato ai dati inseriti a
// mano in quei due moduli — mai una scrittura automatica sui loro dati
// economici/di previsione, solo un numero di riferimento da poter copiare.
const REPARTO_A_CATEGORIA_PROFIT = { CARROZZERIA: "carrozziere", VERNICIATURA: "verniciatore", MECCANICA: "meccanico" };
const REPARTO_A_DEPARTMENT_DELAY = { CARROZZERIA: "carrozzeria", MECCANICA: "meccanica", VERNICIATURA: "verniciatura", FINITURA: "finitura" };

// GET /api/vehicles/:vehicleId/ore-lavorate — ore reali tracciate per
// reparto su questa pratica (staff): collega la Modalità Tecnico al
// Profit Tracker e al Predictive Delay AI come riferimento, senza mai
// sovrascrivere automaticamente i dati inseriti manualmente in quei moduli.
export const vehicleOreLavorateRouter = Router({ mergeParams: true });
vehicleOreLavorateRouter.use(requireAuth);
vehicleOreLavorateRouter.get("/", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const orders = await prisma.workOrder.findMany({
    where: { vehicleId: req.params.vehicleId, tenantId },
    select: { reparto: true, timeEntries: { select: { inizio: true, fine: true } } },
  });
  const perReparto = REPARTI.map((reparto) => {
    const ore = Number(oreReali(orders.filter((o) => o.reparto === reparto).flatMap((o) => o.timeEntries)).toFixed(2));
    return { reparto, ore, categoriaProfitTracker: REPARTO_A_CATEGORIA_PROFIT[reparto] || null, departmentDelay: REPARTO_A_DEPARTMENT_DELAY[reparto] };
  });
  res.json(perReparto);
}));


// GET /api/work-orders/mie — "I MIEI LAVORI" per il tecnico autenticato.
workOrdersRouter.get("/mie", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const tutte = req.query.tutte === "1";
  const orders = await prisma.workOrder.findMany({
    where: { tenantId, tecnicoId: req.auth.userId, ...(tutte ? {} : { stato: { not: "COMPLETATA" } }) },
    select: woSelect,
    orderBy: [{ priorita: "desc" }, { dataConsegna: "asc" }, { createdAt: "asc" }],
  });
  res.json(orders.map(conOreReali));
}));

// --- Impostazioni tenant per la Modalità Tecnico (solo ADMIN) ---
// Registrate PRIMA delle route con parametro /:id qui sotto, altrimenti
// "impostazioni" verrebbe interpretato come un id lavorazione.
workOrdersRouter.get("/impostazioni", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { consentiLavorazioniSimultanee: true } });
  res.json(tenant);
}));
workOrdersRouter.patch("/impostazioni", requireRole("ADMIN"), wrap(async (req, res) => {
  const parsed = z.object({ consentiLavorazioniSimultanee: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valore non valido" });
  const { tenantId } = tenantScope(req);
  const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: parsed.data, select: { consentiLavorazioniSimultanee: true } });
  res.json(tenant);
}));

// --- KPI per tecnico e reparto (ADMIN/AMMINISTRAZIONE) ---
// Confronto descrittivo ore previste/reali: nessun punteggio, ranking o
// soglia di giudizio automatica sul tecnico — solo somme e scostamenti,
// da leggere insieme al contesto (priorità, complessità, interruzioni).
const RUOLI_KPI = new Set(["ADMIN", "AMMINISTRAZIONE"]);
const requireKpiRole = wrap(async (req, res, next) => {
  const user = await prisma.user.findFirst({ where: { id: req.auth.userId, tenantId: req.auth.tenantId, attivo: true }, select: { ruolo: true } });
  if (!user || !RUOLI_KPI.has(user.ruolo)) return res.status(403).json({ error: "Funzione riservata ad Admin e Amministrazione." });
  next();
});

workOrdersRouter.get("/kpi/tecnici", requireKpiRole, wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const orders = await prisma.workOrder.findMany({
    where: { tenantId },
    select: { tecnicoId: true, stato: true, oreStimate: true, tecnico: { select: { nome: true, cognome: true } }, timeEntries: { select: { inizio: true, fine: true } } },
  });
  const kpi = aggregaKpi(orders, (wo) => wo.tecnicoId, (wo) => `${wo.tecnico.nome} ${wo.tecnico.cognome}`);
  res.json({ kpi, nota: "Confronto descrittivo tra ore previste e ore reali: non è un punteggio né una classifica. Scostamenti vanno letti nel contesto (priorità, imprevisti, complessità)." });
}));

workOrdersRouter.get("/kpi/reparti", requireKpiRole, wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const orders = await prisma.workOrder.findMany({
    where: { tenantId },
    select: { reparto: true, stato: true, oreStimate: true, timeEntries: { select: { inizio: true, fine: true } } },
  });
  const kpi = aggregaKpi(orders, (wo) => wo.reparto, (wo) => wo.reparto);
  res.json({ kpi, nota: "Confronto descrittivo tra ore previste e ore reali per reparto: non è un punteggio né una classifica." });
}));

const patchSchema = workOrderSchema.partial();

// PATCH /api/work-orders/:id — modifica lavorazione (staff).
workOrdersRouter.patch("/:id", wrap(async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const existing = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Lavorazione non trovata" });

  const data = { ...parsed.data };
  if (data.dataConsegna) data.dataConsegna = new Date(data.dataConsegna);

  const wo = await prisma.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({ where: { id: existing.id }, data, select: woSelect });
    if (parsed.data.tecnicoId && parsed.data.tecnicoId !== existing.tecnicoId) {
      await tx.workOrderEvento.create({
        data: { tenantId, workOrderId: existing.id, tipo: "RIASSEGNATA", attoreId: req.auth.userId,
          dettagli: { daTecnicoId: existing.tecnicoId, aTecnicoId: parsed.data.tecnicoId } },
      });
    }
    return updated;
  });
  res.json(conOreReali(wo));
}));

// DELETE /api/work-orders/:id — staff.
workOrdersRouter.delete("/:id", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const existing = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Lavorazione non trovata" });
  await prisma.$transaction([
    prisma.workOrderTimeEntry.deleteMany({ where: { workOrderId: existing.id, tenantId } }),
    prisma.workOrderEvento.deleteMany({ where: { workOrderId: existing.id, tenantId } }),
    prisma.workOrder.delete({ where: { id: existing.id } }),
  ]);
  res.status(204).send();
}));

// Solo il tecnico assegnato, o un ADMIN/ACCETTATORE, possono azionare
// Inizia/Pausa/Termina — evita che un tecnico avvii per errore il lavoro
// di un collega.
async function autorizzatoAdAzionare(req, wo) {
  if (wo.tecnicoId === req.auth.userId) return true;
  const user = await prisma.user.findFirst({ where: { id: req.auth.userId, tenantId: req.auth.tenantId, attivo: true }, select: { ruolo: true } });
  return user && ["ADMIN", "ACCETTATORE"].includes(user.ruolo);
}

// POST /api/work-orders/:id/inizia
// Se il tecnico ha già un'altra lavorazione IN_CORSO e il tenant non
// consente lavorazioni simultanee, questa viene messa in pausa
// automaticamente ("cambio lavorazione") invece di bloccare l'operazione.
workOrdersRouter.post("/:id/inizia", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const wo = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!wo) return res.status(404).json({ error: "Lavorazione non trovata" });
  if (!(await autorizzatoAdAzionare(req, wo))) return res.status(403).json({ error: "Non sei il tecnico assegnato a questa lavorazione." });
  if (wo.stato === "IN_CORSO") return res.status(400).json({ error: "Lavorazione già in corso." });
  if (wo.stato === "COMPLETATA") return res.status(400).json({ error: "Lavorazione già terminata." });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { consentiLavorazioniSimultanee: true } });

  const risultato = await prisma.$transaction(async (tx) => {
    let cambiataDa = null;
    if (!tenant.consentiLavorazioniSimultanee) {
      const altraInCorso = await tx.workOrder.findFirst({ where: { tenantId, tecnicoId: wo.tecnicoId, stato: "IN_CORSO", id: { not: wo.id } } });
      if (altraInCorso) {
        await tx.workOrderTimeEntry.updateMany({ where: { workOrderId: altraInCorso.id, fine: null }, data: { fine: new Date() } });
        await tx.workOrder.update({ where: { id: altraInCorso.id }, data: { stato: "IN_PAUSA" } });
        await tx.workOrderEvento.create({ data: { tenantId, workOrderId: altraInCorso.id, tipo: "PAUSA", daStato: "IN_CORSO", aStato: "IN_PAUSA", attoreId: req.auth.userId, dettagli: { motivo: "cambio lavorazione" } } });
        cambiataDa = altraInCorso.id;
      }
    }

    const eraInPausa = wo.stato === "IN_PAUSA";
    await tx.workOrderTimeEntry.create({ data: { tenantId, workOrderId: wo.id, tecnicoId: wo.tecnicoId, inizio: new Date() } });
    const updated = await tx.workOrder.update({ where: { id: wo.id }, data: { stato: "IN_CORSO" }, select: woSelect });
    await tx.workOrderEvento.create({ data: { tenantId, workOrderId: wo.id, tipo: eraInPausa ? "RIPRESA" : "INIZIATA", daStato: wo.stato, aStato: "IN_CORSO", attoreId: req.auth.userId } });
    return { updated, cambiataDa };
  });

  res.json({ ...conOreReali(risultato.updated), cambiataDaLavorazioneId: risultato.cambiataDa });
}));

// POST /api/work-orders/:id/pausa
workOrdersRouter.post("/:id/pausa", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const wo = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!wo) return res.status(404).json({ error: "Lavorazione non trovata" });
  if (!(await autorizzatoAdAzionare(req, wo))) return res.status(403).json({ error: "Non sei il tecnico assegnato a questa lavorazione." });
  if (wo.stato !== "IN_CORSO") return res.status(400).json({ error: "La lavorazione non è in corso." });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.workOrderTimeEntry.updateMany({ where: { workOrderId: wo.id, fine: null }, data: { fine: new Date() } });
    const u = await tx.workOrder.update({ where: { id: wo.id }, data: { stato: "IN_PAUSA" }, select: woSelect });
    await tx.workOrderEvento.create({ data: { tenantId, workOrderId: wo.id, tipo: "PAUSA", daStato: "IN_CORSO", aStato: "IN_PAUSA", attoreId: req.auth.userId } });
    return u;
  });
  res.json(conOreReali(updated));
}));

// POST /api/work-orders/:id/termina
workOrdersRouter.post("/:id/termina", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const wo = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!wo) return res.status(404).json({ error: "Lavorazione non trovata" });
  if (!(await autorizzatoAdAzionare(req, wo))) return res.status(403).json({ error: "Non sei il tecnico assegnato a questa lavorazione." });
  if (!["IN_CORSO", "IN_PAUSA"].includes(wo.stato)) return res.status(400).json({ error: "Lavorazione non avviata." });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.workOrderTimeEntry.updateMany({ where: { workOrderId: wo.id, fine: null }, data: { fine: new Date() } });
    const u = await tx.workOrder.update({ where: { id: wo.id }, data: { stato: "COMPLETATA" }, select: woSelect });
    await tx.workOrderEvento.create({ data: { tenantId, workOrderId: wo.id, tipo: "TERMINATA", daStato: wo.stato, aStato: "COMPLETATA", attoreId: req.auth.userId } });
    return u;
  });
  res.json(conOreReali(updated));
}));

// GET /api/work-orders/:id/eventi — storico modifiche (staff).
workOrdersRouter.get("/:id/eventi", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const wo = await prisma.workOrder.findFirst({ where: { id: req.params.id, tenantId } });
  if (!wo) return res.status(404).json({ error: "Lavorazione non trovata" });
  const eventi = await prisma.workOrderEvento.findMany({
    where: { workOrderId: wo.id, tenantId },
    orderBy: { createdAt: "desc" },
    include: { attore: { select: { nome: true, cognome: true } } },
  });
  res.json(eventi);
}));

const correzioneSchema = z.object({
  inizio: z.string().datetime(),
  fine: z.string().datetime().nullable(),
  motivo: z.string().min(1).max(500),
});

// PATCH /api/work-order-time-entries/:id — correzione manuale autorizzata
// (solo ADMIN/ACCETTATORE: un tecnico non corregge da solo le proprie ore).
workOrderTimeEntriesRouter.patch("/:id", requireRole("ADMIN", "ACCETTATORE"), wrap(async (req, res) => {
  const parsed = correzioneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.fine && new Date(parsed.data.fine) < new Date(parsed.data.inizio)) {
    return res.status(400).json({ error: "L'orario di fine non può precedere l'inizio." });
  }

  const { tenantId } = tenantScope(req);
  const existing = await prisma.workOrderTimeEntry.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return res.status(404).json({ error: "Segmento non trovato" });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.workOrderTimeEntry.update({
      where: { id: existing.id },
      data: {
        inizio: new Date(parsed.data.inizio), fine: parsed.data.fine ? new Date(parsed.data.fine) : null,
        correzioneManuale: true, correzioneMotivo: parsed.data.motivo, correzioneDaId: req.auth.userId, correzioneAt: new Date(),
      },
    });
    await tx.workOrderEvento.create({
      data: {
        tenantId, workOrderId: existing.workOrderId, tipo: "CORREZIONE_MANUALE", attoreId: req.auth.userId,
        dettagli: {
          segmentoId: existing.id, motivo: parsed.data.motivo,
          vecchioInizio: existing.inizio, vecchioFine: existing.fine,
          nuovoInizio: u.inizio, nuovoFine: u.fine,
        },
      },
    });
    return u;
  });
  res.json(updated);
}));
