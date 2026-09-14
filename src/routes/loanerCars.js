import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { day, addDays } from "../lib/delay.js";
import {
  carCreateSchema,
  carUpdateSchema,
  bookingCreateSchema,
  bookingPatchSchema,
  assignSchema,
  returnSchema,
  carAlerts,
  fleetAlerts,
  detectOverlapPairs,
  findBookingOverlaps,
  computeBookingCostCents,
  buildCalendar,
  BOOKING_ATTIVE,
} from "../lib/loaner.js";

export const loanerCarsRouter = Router();
loanerCarsRouter.use(requireAuth);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Include compatto delle prenotazioni con cliente e pratica collegati.
const bookingInclude = {
  client: { select: { id: true, nome: true, cognome: true, telefono: true } },
  vehicle: { select: { id: true, marca: true, modello: true, targa: true } },
};

// Converte le stringhe data (ISO) in Date per i campi del modello.
const toDate = (v) => (v == null ? v : new Date(v));

// Deriva lo stato dell'auto dalle sue prenotazioni. Gli stati manuali
// MANUTENZIONE / NON_DISPONIBILE non vengono mai sovrascritti automaticamente.
function deriveCarStato(currentStato, bookings) {
  if (["MANUTENZIONE", "NON_DISPONIBILE"].includes(currentStato)) return currentStato;
  if (bookings.some((b) => b.stato === "ASSEGNATA")) return "ASSEGNATA";
  if (bookings.some((b) => b.stato === "PRENOTATA")) return "PRENOTATA";
  return "DISPONIBILE";
}

// Ricarica le prenotazioni attive dell'auto e ne aggiorna lo stato.
async function syncCarStato(tx, carId) {
  const car = await tx.loanerCar.findUnique({ where: { id: carId }, select: { stato: true } });
  if (!car) return;
  const bookings = await tx.loanerBooking.findMany({
    where: { loanerCarId: carId, stato: { in: BOOKING_ATTIVE } },
    select: { stato: true },
  });
  const nextStato = deriveCarStato(car.stato, bookings);
  if (nextStato !== car.stato) await tx.loanerCar.update({ where: { id: carId }, data: { stato: nextStato } });
}

// Verifica che cliente / pratica appartengano al tenant, se indicati.
async function assertTenantRefs(req, { clientId, vehicleId }) {
  if (clientId) {
    const client = await prisma.client.findFirst({ where: { id: clientId, ...tenantScope(req) }, select: { id: true } });
    if (!client) return "Cliente non trovato";
  }
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, ...tenantScope(req) }, select: { id: true } });
    if (!vehicle) return "Pratica (veicolo) non trovata";
  }
  return null;
}

// -----------------------------
// FLOTTA
// -----------------------------

// GET /api/loaner-cars — elenco flotta con prenotazione attiva e alert.
loanerCarsRouter.get("/", wrap(async (req, res) => {
  const includeInactive = req.query.includeInactive === "1";
  const cars = await prisma.loanerCar.findMany({
    where: { ...tenantScope(req), ...(includeInactive ? {} : { attiva: true }) },
    include: {
      bookings: {
        where: { stato: { in: BOOKING_ATTIVE } },
        orderBy: { dataInizio: "asc" },
        include: bookingInclude,
      },
    },
    orderBy: { targa: "asc" },
  });
  const now = new Date();
  res.json(
    cars.map((c) => ({
      ...c,
      prenotazioneAttiva: c.bookings.find((b) => b.stato === "ASSEGNATA") ?? null,
      alerts: [
        ...carAlerts(c, { now }),
        ...detectOverlapPairs(c.bookings).map(([x, y]) => ({
          code: "PRENOTAZIONI_SOVRAPPOSTE",
          level: "critical",
          message: `⚠️ Prenotazioni sovrapposte (${day(x.dataInizio)} e ${day(y.dataInizio)})`,
          bookingIds: [x.id, y.id],
        })),
      ],
    }))
  );
}));

// GET /api/loaner-cars/alerts — tutti gli alert della flotta.
loanerCarsRouter.get("/alerts", wrap(async (req, res) => {
  const cars = await prisma.loanerCar.findMany({ where: { ...tenantScope(req), attiva: true } });
  const bookings = await prisma.loanerBooking.findMany({
    where: { ...tenantScope(req), stato: { in: BOOKING_ATTIVE } },
    select: { id: true, loanerCarId: true, stato: true, dataInizio: true, dataFinePrevista: true, dataRestituzione: true },
  });
  const byCar = {};
  for (const b of bookings) (byCar[b.loanerCarId] ||= []).push(b);
  res.json(fleetAlerts(cars, byCar, { now: new Date() }));
}));

// GET /api/loaner-cars/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
loanerCarsRouter.get("/calendar", wrap(async (req, res) => {
  const q = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Intervallo non valido" });
  const from = q.data.from ?? day(new Date());
  const to = q.data.to ?? addDays(from, 13);
  if (to < from) return res.status(400).json({ error: "Intervallo non valido" });
  // Limita la finestra a 62 giorni per non generare griglie enormi.
  const days = [];
  for (let d = from; d <= to && days.length < 62; d = addDays(d, 1)) days.push(d);

  const cars = await prisma.loanerCar.findMany({ where: { ...tenantScope(req), attiva: true }, orderBy: { targa: "asc" } });
  const bookings = await prisma.loanerBooking.findMany({
    where: { ...tenantScope(req), stato: { in: BOOKING_ATTIVE } },
    include: bookingInclude,
  });
  res.json(buildCalendar(cars, bookings, days));
}));

// GET /api/loaner-cars/:id
loanerCarsRouter.get("/:id", wrap(async (req, res) => {
  const car = await prisma.loanerCar.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { bookings: { orderBy: { dataInizio: "desc" }, take: 50, include: bookingInclude } },
  });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  const active = car.bookings.filter((b) => BOOKING_ATTIVE.includes(b.stato));
  res.json({
    ...car,
    prenotazioneAttiva: car.bookings.find((b) => b.stato === "ASSEGNATA") ?? null,
    alerts: [
      ...carAlerts(car, { now: new Date() }),
      ...detectOverlapPairs(active).map(([x, y]) => ({
        code: "PRENOTAZIONI_SOVRAPPOSTE",
        level: "critical",
        message: `⚠️ Prenotazioni sovrapposte (${day(x.dataInizio)} e ${day(y.dataInizio)})`,
        bookingIds: [x.id, y.id],
      })),
    ],
  });
}));

// POST /api/loaner-cars
loanerCarsRouter.post("/", wrap(async (req, res) => {
  const parsed = carCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const car = await prisma.loanerCar.create({
    data: {
      ...tenantScope(req),
      targa: d.targa,
      marca: d.marca,
      modello: d.modello,
      km: d.km ?? null,
      carburante: d.carburante ?? null,
      stato: d.stato ?? "DISPONIBILE",
      assicurazioneCompagnia: d.assicurazioneCompagnia ?? null,
      assicurazioneScadenza: toDate(d.assicurazioneScadenza) ?? null,
      revisioneScadenza: toDate(d.revisioneScadenza) ?? null,
      manutenzioneNote: d.manutenzioneNote ?? null,
      manutenzioneScadenza: toDate(d.manutenzioneScadenza) ?? null,
      manutenzioneKm: d.manutenzioneKm ?? null,
      costoGiornalieroCents: d.costoGiornalieroCents ?? 0,
      note: d.note ?? null,
      foto: d.foto ?? [],
    },
  });
  res.status(201).json(car);
}));

// PATCH /api/loaner-cars/:id
loanerCarsRouter.patch("/:id", wrap(async (req, res) => {
  const parsed = carUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const data = {};
  for (const k of ["targa", "marca", "modello", "km", "carburante", "stato", "assicurazioneCompagnia", "manutenzioneNote", "manutenzioneKm", "costoGiornalieroCents", "note", "foto", "attiva"]) {
    if (d[k] !== undefined) data[k] = d[k];
  }
  for (const k of ["assicurazioneScadenza", "revisioneScadenza", "manutenzioneScadenza"]) {
    if (d[k] !== undefined) data[k] = toDate(d[k]);
  }
  const { count } = await prisma.loanerCar.updateMany({ where: { id: req.params.id, ...tenantScope(req) }, data });
  if (count === 0) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  const car = await prisma.loanerCar.findUnique({ where: { id: req.params.id } });
  res.json(car);
}));

// DELETE /api/loaner-cars/:id — consentito solo senza prenotazioni; altrimenti
// suggerisce di dismettere l'auto (attiva=false) per conservarne lo storico.
loanerCarsRouter.delete("/:id", wrap(async (req, res) => {
  const car = await prisma.loanerCar.findFirst({ where: { id: req.params.id, ...tenantScope(req) }, include: { _count: { select: { bookings: true } } } });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  if (car._count.bookings > 0) {
    return res.status(409).json({ error: "Auto con storico prenotazioni: usa 'Dismetti dalla flotta' invece di eliminarla" });
  }
  await prisma.loanerCar.delete({ where: { id: car.id } });
  res.status(204).end();
}));

// -----------------------------
// PRENOTAZIONI / ASSEGNAZIONI
// -----------------------------

// POST /api/loaner-cars/:id/bookings — crea una prenotazione (finestra).
loanerCarsRouter.post("/:id/bookings", wrap(async (req, res) => {
  const parsed = bookingCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const car = await prisma.loanerCar.findFirst({ where: { id: req.params.id, ...tenantScope(req) } });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  if (["MANUTENZIONE", "NON_DISPONIBILE"].includes(car.stato)) {
    return res.status(409).json({ error: `Auto non prenotabile (stato ${car.stato})` });
  }

  const refErr = await assertTenantRefs(req, d);
  if (refErr) return res.status(400).json({ error: refErr });

  const existing = await prisma.loanerBooking.findMany({ where: { loanerCarId: car.id, stato: { in: BOOKING_ATTIVE } } });
  const overlaps = findBookingOverlaps(existing, { start: d.dataInizio, end: d.dataFinePrevista ?? null });
  if (overlaps.length) return res.status(409).json({ error: "La finestra si sovrappone a un'altra prenotazione di questa auto" });

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.loanerBooking.create({
      data: {
        ...tenantScope(req),
        loanerCarId: car.id,
        clientId: d.clientId ?? null,
        vehicleId: d.vehicleId ?? null,
        stato: "PRENOTATA",
        dataInizio: toDate(d.dataInizio),
        dataFinePrevista: toDate(d.dataFinePrevista) ?? null,
        note: d.note ?? null,
        costoGiornalieroCents: car.costoGiornalieroCents,
      },
      include: bookingInclude,
    });
    await syncCarStato(tx, car.id);
    return created;
  });
  res.status(201).json(booking);
}));

// PATCH /api/loaner-cars/:id/bookings/:bookingId — modifica campi liberi.
loanerCarsRouter.patch("/:id/bookings/:bookingId", wrap(async (req, res) => {
  const parsed = bookingPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, loanerCarId: req.params.id, ...tenantScope(req) } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });

  const refErr = await assertTenantRefs(req, d);
  if (refErr) return res.status(400).json({ error: refErr });

  // Se cambiano le date, ricontrolla le sovrapposizioni.
  if ((d.dataInizio || d.dataFinePrevista !== undefined) && BOOKING_ATTIVE.includes(booking.stato)) {
    const start = d.dataInizio ?? booking.dataInizio;
    const end = d.dataFinePrevista !== undefined ? d.dataFinePrevista : booking.dataFinePrevista;
    const existing = await prisma.loanerBooking.findMany({ where: { loanerCarId: booking.loanerCarId, stato: { in: BOOKING_ATTIVE } } });
    if (findBookingOverlaps(existing, { start, end, ignoreId: booking.id }).length) {
      return res.status(409).json({ error: "La finestra si sovrappone a un'altra prenotazione di questa auto" });
    }
  }

  const data = {};
  for (const k of ["clientId", "vehicleId", "note", "attribuitaAllaPratica"]) if (d[k] !== undefined) data[k] = d[k];
  for (const k of ["dataInizio", "dataFinePrevista"]) if (d[k] !== undefined) data[k] = toDate(d[k]);

  const updated = await prisma.loanerBooking.update({ where: { id: booking.id }, data, include: bookingInclude });
  res.json(updated);
}));

// PATCH /api/loaner-cars/:id/bookings/:bookingId/assegna — consegna al cliente.
loanerCarsRouter.patch("/:id/bookings/:bookingId/assegna", wrap(async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, loanerCarId: req.params.id, ...tenantScope(req) }, include: { loanerCar: true } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (!["PRENOTATA", "ASSEGNATA"].includes(booking.stato)) {
    return res.status(409).json({ error: "Solo una prenotazione attiva può essere assegnata" });
  }
  if (["MANUTENZIONE", "NON_DISPONIBILE"].includes(booking.loanerCar.stato)) {
    return res.status(409).json({ error: `Auto non assegnabile (stato ${booking.loanerCar.stato})` });
  }

  const refErr = await assertTenantRefs(req, { clientId: d.clientId, vehicleId: d.vehicleId });
  if (refErr) return res.status(400).json({ error: refErr });

  const dataConsegna = toDate(d.dataConsegna) ?? new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.loanerBooking.update({
      where: { id: booking.id },
      data: {
        stato: "ASSEGNATA",
        clientId: d.clientId,
        vehicleId: d.vehicleId ?? booking.vehicleId ?? null,
        dataConsegna,
        dataFinePrevista: d.dataFinePrevista !== undefined ? toDate(d.dataFinePrevista) : booking.dataFinePrevista,
        kmIniziali: d.kmIniziali ?? booking.kmIniziali ?? null,
        carburanteIniziale: d.carburanteIniziale ?? booking.carburanteIniziale ?? null,
        fotoConsegna: d.fotoConsegna ?? booking.fotoConsegna,
        firmaClienteDataUrl: d.firmaClienteDataUrl ?? booking.firmaClienteDataUrl ?? null,
        firmatarioNome: d.firmatarioNome ?? booking.firmatarioNome ?? null,
        firmaAt: d.firmaClienteDataUrl ? new Date() : booking.firmaAt,
        note: d.note ?? booking.note,
        attribuitaAllaPratica: d.attribuitaAllaPratica ?? booking.attribuitaAllaPratica,
        costoGiornalieroCents: booking.loanerCar.costoGiornalieroCents,
      },
      include: bookingInclude,
    });
    await syncCarStato(tx, booking.loanerCarId);
    return b;
  });
  res.json(updated);
}));

// PATCH /api/loaner-cars/:id/bookings/:bookingId/restituzione — rientro.
loanerCarsRouter.patch("/:id/bookings/:bookingId/restituzione", wrap(async (req, res) => {
  const parsed = returnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, loanerCarId: req.params.id, ...tenantScope(req) }, include: { loanerCar: true } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (booking.stato !== "ASSEGNATA") return res.status(409).json({ error: "Solo un'auto assegnata può rientrare" });

  if (d.kmFinali != null && booking.kmIniziali != null && d.kmFinali < booking.kmIniziali) {
    return res.status(400).json({ error: "I km finali non possono essere inferiori a quelli iniziali" });
  }

  const dataRestituzione = toDate(d.dataRestituzione) ?? new Date();
  const start = booking.dataConsegna ?? booking.dataInizio;
  const costoTotaleCents = computeBookingCostCents(booking.costoGiornalieroCents, start, dataRestituzione);

  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.loanerBooking.update({
      where: { id: booking.id },
      data: {
        stato: "RESTITUITA",
        dataRestituzione,
        kmFinali: d.kmFinali ?? null,
        carburanteFinale: d.carburanteFinale ?? null,
        fotoRestituzione: d.fotoRestituzione ?? booking.fotoRestituzione,
        danni: d.danni ?? booking.danni,
        note: d.note ?? booking.note,
        costoTotaleCents,
        attribuitaAllaPratica: d.attribuitaAllaPratica ?? booking.attribuitaAllaPratica,
      },
      include: bookingInclude,
    });
    // Aggiorna il chilometraggio dell'auto al rientro.
    if (d.kmFinali != null) await tx.loanerCar.update({ where: { id: booking.loanerCarId }, data: { km: d.kmFinali } });
    await syncCarStato(tx, booking.loanerCarId);
    return b;
  });
  res.json(updated);
}));

// PATCH /api/loaner-cars/:id/bookings/:bookingId/annulla — annulla prenotazione.
loanerCarsRouter.patch("/:id/bookings/:bookingId/annulla", wrap(async (req, res) => {
  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, loanerCarId: req.params.id, ...tenantScope(req) } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (!BOOKING_ATTIVE.includes(booking.stato)) return res.status(409).json({ error: "Prenotazione non annullabile" });

  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.loanerBooking.update({ where: { id: booking.id }, data: { stato: "ANNULLATA" }, include: bookingInclude });
    await syncCarStato(tx, booking.loanerCarId);
    return b;
  });
  res.json(updated);
}));
