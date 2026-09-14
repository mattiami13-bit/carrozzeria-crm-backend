import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { ledgerSchema, emptyLedger } from "../lib/profit.js";

// Auto Sostitutive: flotta, calendario disponibilità, assegnazione/
// restituzione con firma e fotografie, costo interno collegabile (mai in
// automatico) al Profit Tracker, alert scadenze e sovrapposizioni.

export const loanerCarsRouter = Router();
loanerCarsRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 10 } });

const BOOKING_ATTIVI = ["PRENOTATA", "ASSEGNATA"];

// Stato calcolato: MANUTENZIONE/NON_DISPONIBILE se impostati manualmente,
// altrimenti ASSEGNATA/PRENOTATA/DISPONIBILE secondo le prenotazioni —
// mai un campo salvato a parte che rischierebbe di andare fuori sincrono.
function statoCalcolato(car, ora = new Date()) {
  if (car.statoManuale) return car.statoManuale;
  const assegnata = car.bookings.find((b) => b.stato === "ASSEGNATA");
  if (assegnata) return "ASSEGNATA";
  const prenotata = car.bookings.find((b) => b.stato === "PRENOTATA" && new Date(b.dataInizioPrevista) <= addGiorni(ora, 30));
  if (prenotata) return "PRENOTATA";
  return "DISPONIBILE";
}
function addGiorni(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function giorniTra(a, b) { return Math.max(1, Math.ceil((new Date(b) - new Date(a)) / 86400000)); }

function carSelect() {
  return {
    id: true, targa: true, marca: true, modello: true, km: true, carburante: true,
    assicurazioneScadenza: true, revisioneScadenza: true, manutenzioneScadenza: true,
    tariffaGiornalieraCents: true, note: true, statoManuale: true, createdAt: true,
    bookings: { where: { stato: { in: BOOKING_ATTIVI } }, orderBy: { dataInizioPrevista: "asc" }, include: { client: { select: { nome: true, cognome: true } } } },
    _count: { select: { photos: true } },
  };
}
// Aggiunge stato calcolato e prenotazione attiva SENZA rimuovere
// "bookings": nella vista dettaglio serve lo storico completo, in quella
// elenco è già limitato alle sole prenotazioni attive da carSelect().
function conStato(car) {
  const bookings = car.bookings || [];
  return { ...car, stato: statoCalcolato(car), prenotazioneAttiva: bookings.find((b) => b.stato === "ASSEGNATA") || bookings.find((b) => b.stato === "PRENOTATA") || null };
}

// GET /api/loaner-cars
loanerCarsRouter.get("/", wrap(async (req, res) => {
  const cars = await prisma.loanerCar.findMany({ where: tenantScope(req), select: carSelect(), orderBy: { targa: "asc" } });
  res.json(cars.map(conStato));
}));

// GET /api/loaner-cars/alert — scadenze in avvicinamento/scadute e
// sovrapposizioni tra prenotazioni attive sulla stessa auto.
loanerCarsRouter.get("/alert", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const cars = await prisma.loanerCar.findMany({
    where: { tenantId },
    select: { id: true, targa: true, marca: true, modello: true, assicurazioneScadenza: true, revisioneScadenza: true, manutenzioneScadenza: true,
      bookings: { where: { stato: { in: BOOKING_ATTIVI } }, select: { id: true, dataInizioPrevista: true, dataFinePrevista: true, dataConsegna: true, dataRestituzione: true, stato: true, client: { select: { nome: true, cognome: true } } } } },
  });

  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const soglia = addGiorni(oggi, 30);
  const scadenze = [];
  for (const c of cars) {
    for (const [tipo, campo] of [["assicurazione", "assicurazioneScadenza"], ["revisione", "revisioneScadenza"], ["manutenzione", "manutenzioneScadenza"]]) {
      const data = c[campo];
      if (!data) continue;
      if (new Date(data) <= soglia) {
        scadenze.push({ loanerCarId: c.id, targa: c.targa, veicolo: `${c.marca} ${c.modello}`, tipo, data, scaduta: new Date(data) < oggi });
      }
    }
  }

  const sovrapposizioni = [];
  for (const c of cars) {
    const attive = c.bookings.filter((b) => BOOKING_ATTIVI.includes(b.stato));
    for (let i = 0; i < attive.length; i++) {
      for (let j = i + 1; j < attive.length; j++) {
        const a = attive[i], b = attive[j];
        const fineA = a.dataFinePrevista || addGiorni(a.dataInizioPrevista, 365);
        const fineB = b.dataFinePrevista || addGiorni(b.dataInizioPrevista, 365);
        if (new Date(a.dataInizioPrevista) < new Date(fineB) && new Date(b.dataInizioPrevista) < new Date(fineA)) {
          sovrapposizioni.push({
            loanerCarId: c.id, targa: c.targa, veicolo: `${c.marca} ${c.modello}`,
            prenotazioneA: { id: a.id, cliente: `${a.client.nome} ${a.client.cognome}`, dal: a.dataInizioPrevista, al: a.dataFinePrevista },
            prenotazioneB: { id: b.id, cliente: `${b.client.nome} ${b.client.cognome}`, dal: b.dataInizioPrevista, al: b.dataFinePrevista },
          });
        }
      }
    }
  }

  res.json({ scadenze, sovrapposizioni });
}));

// GET /api/loaner-cars/:id
loanerCarsRouter.get("/:id", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const car = await prisma.loanerCar.findFirst({
    where: { id: req.params.id, tenantId },
    select: {
      ...carSelect(),
      bookings: { orderBy: { dataInizioPrevista: "desc" }, take: 30, include: {
        client: { select: { nome: true, cognome: true } },
        vehicle: { select: { marca: true, modello: true, targa: true } },
        photos: { select: { id: true, fase: true, mime: true, createdAt: true } },
      } },
    },
  });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  res.json(conStato(car));
}));

const carSchema = z.object({
  targa: z.string().min(1),
  marca: z.string().min(1),
  modello: z.string().min(1),
  km: z.number().int().nonnegative().optional(),
  carburante: z.enum(["BENZINA", "DIESEL", "GPL", "METANO", "ELETTRICA", "IBRIDA"]).optional(),
  assicurazioneScadenza: z.string().datetime().nullable().optional(),
  revisioneScadenza: z.string().datetime().nullable().optional(),
  manutenzioneScadenza: z.string().datetime().nullable().optional(),
  tariffaGiornalieraCents: z.number().int().nonnegative().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  statoManuale: z.enum(["MANUTENZIONE", "NON_DISPONIBILE"]).nullable().optional(),
});

function toDate(v) { return v === undefined ? undefined : v === null ? null : new Date(v); }

// POST /api/loaner-cars
loanerCarsRouter.post("/", wrap(async (req, res) => {
  const parsed = carSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const car = await prisma.loanerCar.create({
    data: {
      ...tenantScope(req), ...parsed.data,
      assicurazioneScadenza: toDate(parsed.data.assicurazioneScadenza),
      revisioneScadenza: toDate(parsed.data.revisioneScadenza),
      manutenzioneScadenza: toDate(parsed.data.manutenzioneScadenza),
    },
  });
  res.status(201).json(car);
}));

const carUpdateSchema = carSchema.partial();

// PATCH /api/loaner-cars/:id
loanerCarsRouter.patch("/:id", wrap(async (req, res) => {
  const parsed = carUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { ...parsed.data };
  if ("assicurazioneScadenza" in data) data.assicurazioneScadenza = toDate(data.assicurazioneScadenza);
  if ("revisioneScadenza" in data) data.revisioneScadenza = toDate(data.revisioneScadenza);
  if ("manutenzioneScadenza" in data) data.manutenzioneScadenza = toDate(data.manutenzioneScadenza);

  const { tenantId } = tenantScope(req);
  const { count } = await prisma.loanerCar.updateMany({ where: { id: req.params.id, tenantId }, data });
  if (count === 0) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  const car = await prisma.loanerCar.findUnique({ where: { id: req.params.id } });
  res.json(car);
}));

// DELETE /api/loaner-cars/:id
loanerCarsRouter.delete("/:id", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const attive = await prisma.loanerBooking.count({ where: { loanerCarId: req.params.id, tenantId, stato: { in: BOOKING_ATTIVI } } });
  if (attive > 0) return res.status(409).json({ error: "Impossibile eliminare: l'auto ha prenotazioni attive." });
  const { count } = await prisma.loanerCar.deleteMany({ where: { id: req.params.id, tenantId } });
  if (count === 0) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  res.status(204).end();
}));

// --- Fotografie flotta (non legate a una prenotazione, es. stato generale) ---

loanerCarsRouter.post("/:id/foto", upload.array("foto", 10), wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const car = await prisma.loanerCar.findFirst({ where: { id: req.params.id, tenantId } });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  if (!req.files?.length) return res.status(400).json({ error: "Nessuna fotografia caricata" });
  const created = await prisma.$transaction(
    req.files.map((f) => prisma.loanerCarPhoto.create({ data: { tenantId, loanerCarId: car.id, content: f.buffer, mime: f.mimetype, size: f.size }, select: { id: true, mime: true, size: true, createdAt: true } }))
  );
  res.status(201).json(created);
}));

loanerCarsRouter.get("/:id/foto", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const foto = await prisma.loanerCarPhoto.findMany({ where: { loanerCarId: req.params.id, tenantId }, select: { id: true, mime: true, size: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  res.json(foto);
}));

loanerCarsRouter.get("/:id/foto/:fotoId", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const foto = await prisma.loanerCarPhoto.findFirst({ where: { id: req.params.fotoId, loanerCarId: req.params.id, tenantId } });
  if (!foto) return res.status(404).json({ error: "Fotografia non disponibile" });
  res.set({ "Content-Type": foto.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }).send(Buffer.from(foto.content));
}));

// --- Calendario / prenotazioni ---

loanerCarsRouter.get("/:id/prenotazioni", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const bookings = await prisma.loanerBooking.findMany({
    where: { loanerCarId: req.params.id, tenantId },
    orderBy: { dataInizioPrevista: "desc" },
    include: { client: { select: { nome: true, cognome: true } }, vehicle: { select: { marca: true, modello: true, targa: true } } },
  });
  res.json(bookings);
}));

const prenotaSchema = z.object({
  clientId: z.string().min(1),
  vehicleId: z.string().optional(),
  dataInizioPrevista: z.string().datetime(),
  dataFinePrevista: z.string().datetime().optional(),
});

// POST /api/loaner-cars/:id/prenotazioni — crea una prenotazione (calendario
// disponibilità). Non blocca le sovrapposizioni (restano frequenti e
// legittime, es. ritiro/riconsegna lo stesso giorno): le segnala tramite
// l'endpoint /alert e in risposta a questa chiamata.
loanerCarsRouter.post("/:id/prenotazioni", wrap(async (req, res) => {
  const parsed = prenotaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const car = await prisma.loanerCar.findFirst({ where: { id: req.params.id, tenantId } });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });

  const client = await prisma.client.findFirst({ where: { id: parsed.data.clientId, tenantId } });
  if (!client) return res.status(400).json({ error: "Cliente non valido" });
  if (parsed.data.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: parsed.data.vehicleId, tenantId } });
    if (!vehicle) return res.status(400).json({ error: "Pratica/veicolo non valido" });
  }

  const inizio = new Date(parsed.data.dataInizioPrevista);
  const fine = parsed.data.dataFinePrevista ? new Date(parsed.data.dataFinePrevista) : null;

  const altreAttive = await prisma.loanerBooking.findMany({ where: { loanerCarId: car.id, tenantId, stato: { in: BOOKING_ATTIVI } } });
  const sovrapposta = altreAttive.some((b) => {
    const fineB = b.dataFinePrevista || addGiorni(b.dataInizioPrevista, 365);
    const fineNuova = fine || addGiorni(inizio, 365);
    return inizio < new Date(fineB) && new Date(b.dataInizioPrevista) < fineNuova;
  });

  const booking = await prisma.loanerBooking.create({
    data: { tenantId, loanerCarId: car.id, clientId: client.id, vehicleId: parsed.data.vehicleId || null,
      dataInizioPrevista: inizio, dataFinePrevista: fine, creataDaId: req.auth.userId },
  });
  res.status(201).json({ ...booking, sovrapposizioneRilevata: sovrapposta });
}));

// POST /api/loaner-cars/prenotazioni/:bookingId/annulla
loanerCarsRouter.post("/prenotazioni/:bookingId/annulla", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, tenantId } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (booking.stato !== "PRENOTATA") return res.status(400).json({ error: "Solo una prenotazione non ancora consegnata può essere annullata." });
  const updated = await prisma.loanerBooking.update({ where: { id: booking.id }, data: { stato: "ANNULLATA" } });
  res.json(updated);
}));

const consegnaSchema = z.object({
  kmIniziali: z.coerce.number().int().nonnegative(),
  carburanteIniziale: z.enum(["VUOTO", "UN_QUARTO", "META", "TRE_QUARTI", "PIENO"]),
  firmaClienteDataUrl: z.string().min(1),
  firmatarioNome: z.string().min(1),
});

// POST /api/loaner-cars/prenotazioni/:bookingId/consegna
// multipart: campi sopra + foto[] (fotografie di consegna).
loanerCarsRouter.post("/prenotazioni/:bookingId/consegna", upload.array("foto", 10), wrap(async (req, res) => {
  const parsed = consegnaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, tenantId } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (booking.stato !== "PRENOTATA") return res.status(400).json({ error: "Questa prenotazione non è in attesa di consegna." });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.loanerBooking.update({
      where: { id: booking.id },
      data: {
        stato: "ASSEGNATA", dataConsegna: new Date(),
        kmIniziali: parsed.data.kmIniziali, carburanteIniziale: parsed.data.carburanteIniziale,
        firmaClienteDataUrl: parsed.data.firmaClienteDataUrl, firmatarioNome: parsed.data.firmatarioNome,
      },
    });
    for (const f of req.files || []) {
      await tx.loanerBookingPhoto.create({ data: { tenantId, bookingId: booking.id, fase: "CONSEGNA", content: f.buffer, mime: f.mimetype, size: f.size } });
    }
    await tx.loanerCar.update({ where: { id: booking.loanerCarId }, data: { km: parsed.data.kmIniziali, disponibile: false } });
    return u;
  });
  res.json(updated);
}));

const restituzioneSchema = z.object({
  kmFinali: z.coerce.number().int().nonnegative(),
  carburanteFinale: z.enum(["VUOTO", "UN_QUARTO", "META", "TRE_QUARTI", "PIENO"]),
  danniRiscontrati: z.string().max(2000).optional(),
  noteRestituzione: z.string().max(2000).optional(),
});

// POST /api/loaner-cars/prenotazioni/:bookingId/restituzione
loanerCarsRouter.post("/prenotazioni/:bookingId/restituzione", upload.array("foto", 10), wrap(async (req, res) => {
  const parsed = restituzioneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, tenantId }, include: { loanerCar: true } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (booking.stato !== "ASSEGNATA") return res.status(400).json({ error: "Questa auto non risulta assegnata." });
  if (parsed.data.kmFinali < (booking.kmIniziali ?? 0)) return res.status(400).json({ error: "I km finali non possono essere inferiori a quelli di consegna." });

  const dataRestituzione = new Date();
  const giorni = giorniTra(booking.dataConsegna || booking.dataInizioPrevista, dataRestituzione);
  const costoInternoCents = booking.loanerCar.tariffaGiornalieraCents != null ? giorni * booking.loanerCar.tariffaGiornalieraCents : null;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.loanerBooking.update({
      where: { id: booking.id },
      data: {
        stato: "RESTITUITA", dataRestituzione,
        kmFinali: parsed.data.kmFinali, carburanteFinale: parsed.data.carburanteFinale,
        danniRiscontrati: parsed.data.danniRiscontrati || null, noteRestituzione: parsed.data.noteRestituzione || null,
        costoInternoCents,
      },
    });
    for (const f of req.files || []) {
      await tx.loanerBookingPhoto.create({ data: { tenantId, bookingId: booking.id, fase: "RESTITUZIONE", content: f.buffer, mime: f.mimetype, size: f.size } });
    }
    await tx.loanerCar.update({ where: { id: booking.loanerCarId }, data: { km: parsed.data.kmFinali, disponibile: true } });
    return u;
  });
  res.json({ ...updated, giorniUtilizzo: giorni });
}));

loanerCarsRouter.get("/prenotazioni/:bookingId/foto/:fotoId", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const foto = await prisma.loanerBookingPhoto.findFirst({ where: { id: req.params.fotoId, bookingId: req.params.bookingId, tenantId } });
  if (!foto) return res.status(404).json({ error: "Fotografia non disponibile" });
  res.set({ "Content-Type": foto.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }).send(Buffer.from(foto.content));
}));

// POST /api/loaner-cars/prenotazioni/:bookingId/attribuisci-profit
// Aggiunge il costo interno calcolato come voce "sostitutiva" nel Profit
// Tracker della pratica collegata — solo su richiesta esplicita dello
// staff, mai in automatico, e una sola volta per prenotazione.
loanerCarsRouter.post("/prenotazioni/:bookingId/attribuisci-profit", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const booking = await prisma.loanerBooking.findFirst({ where: { id: req.params.bookingId, tenantId }, include: { loanerCar: true } });
  if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });
  if (!booking.vehicleId) return res.status(400).json({ error: "Questa prenotazione non è collegata a nessuna pratica." });
  if (booking.costoInternoCents == null) return res.status(400).json({ error: "Costo interno non calcolabile: imposta una tariffa giornaliera sull'auto e registra la restituzione." });
  if (booking.attribuitoProfitRecordId) return res.status(400).json({ error: "Il costo di questa prenotazione è già stato attribuito." });

  const vehicle = await prisma.vehicle.findFirst({ where: { id: booking.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Pratica non trovata" });

  const existing = await prisma.profitRecord.findFirst({ where: { tenantId, vehicleId: vehicle.id } });
  const ledger = existing ? existing.data : emptyLedger(new Date().toISOString().slice(0, 10));
  const nuovaVoce = {
    id: crypto.randomUUID(), category: "sostitutiva", phase: "actual",
    date: new Date().toISOString().slice(0, 10),
    description: `Auto sostitutiva ${booking.loanerCar.targa} — ${booking.loanerCar.marca} ${booking.loanerCar.modello}`,
    quantity: 1, unitCents: booking.costoInternoCents,
  };
  const nuovoLedger = { ...ledger, costs: [...ledger.costs, nuovaVoce] };
  const parsedLedger = ledgerSchema.safeParse(nuovoLedger);
  if (!parsedLedger.success) return res.status(500).json({ error: "Impossibile aggiungere il costo al Profit Tracker (dati non validi)." });

  const record = await prisma.$transaction(async (tx) => {
    const rec = existing
      ? await tx.profitRecord.update({ where: { id: existing.id }, data: { data: parsedLedger.data, version: { increment: 1 }, updatedById: req.auth.userId } })
      : await tx.profitRecord.create({ data: { tenantId, vehicleId: vehicle.id, data: parsedLedger.data, updatedById: req.auth.userId } });
    await tx.loanerBooking.update({ where: { id: booking.id }, data: { attribuitoProfitRecordId: rec.id } });
    return rec;
  });
  res.json({ profitRecordId: record.id, costoAttribuitoCents: booking.costoInternoCents });
}));
