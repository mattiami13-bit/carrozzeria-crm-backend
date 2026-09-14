import { z } from "zod";
import { day } from "./delay.js";

// ---------------------------------------------------------------
// AUTO SOSTITUTIVE — logica pura (nessun accesso al database).
// Qui vivono: schemi di validazione, calcolo del costo interno,
// rilevazione delle sovrapposizioni di prenotazione, generazione
// degli alert (assicurazione / revisione / manutenzione) e
// l'iniezione del costo nel registro del Profit Tracker.
// ---------------------------------------------------------------

export const FUEL_TYPES = ["BENZINA", "DIESEL", "GPL", "METANO", "ELETTRICO", "IBRIDA"];
export const LOANER_STATI = ["DISPONIBILE", "PRENOTATA", "ASSEGNATA", "MANUTENZIONE", "NON_DISPONIBILE"];
export const BOOKING_STATI = ["PRENOTATA", "ASSEGNATA", "RESTITUITA", "ANNULLATA"];
export const DAMAGE_SEVERITIES = ["LIEVE", "MEDIA", "GRAVE"];

// Prenotazioni che occupano fisicamente l'auto (per sovrapposizioni e stato).
export const BOOKING_ATTIVE = ["PRENOTATA", "ASSEGNATA"];

const MS_PER_DAY = 86400000;

// Soglie di preavviso alert (giorni / km).
export const ALERT_DEFAULTS = { scadenzaGiorni: 30, manutenzioneKm: 1000 };

// ---------------------------------------------------------------
// Schemi di validazione
// ---------------------------------------------------------------
const cents = z.number().int().min(0).max(1000000000);
const km = z.number().int().min(0).max(10000000);
const fuelLevel = z.number().int().min(0).max(100); // percentuale serbatoio
const isoInstant = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Data/ora non valida");

export const photoSchema = z
  .object({ url: z.string().trim().min(1).max(2000), caption: z.string().trim().max(250).default("") })
  .strict();

export const damageSchema = z
  .object({
    descrizione: z.string().trim().min(1).max(500),
    gravita: z.enum(DAMAGE_SEVERITIES).default("LIEVE"),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();

export const carCreateSchema = z
  .object({
    targa: z.string().trim().min(1).max(20),
    marca: z.string().trim().min(1).max(100),
    modello: z.string().trim().min(1).max(100),
    km: km.nullable().optional(),
    carburante: z.enum(FUEL_TYPES).nullable().optional(),
    stato: z.enum(LOANER_STATI).optional(),
    assicurazioneCompagnia: z.string().trim().max(200).nullable().optional(),
    assicurazioneScadenza: isoInstant.nullable().optional(),
    revisioneScadenza: isoInstant.nullable().optional(),
    manutenzioneNote: z.string().trim().max(1000).nullable().optional(),
    manutenzioneScadenza: isoInstant.nullable().optional(),
    manutenzioneKm: km.nullable().optional(),
    costoGiornalieroCents: cents.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    foto: z.array(photoSchema).max(50).optional(),
  })
  .strict();

export const carUpdateSchema = carCreateSchema.partial().extend({ attiva: z.boolean().optional() });

// Prenotazione: riserva una finestra temporale, opzionalmente già con
// cliente/pratica. L'assegnazione vera e propria avviene poi con assignSchema.
export const bookingCreateSchema = z
  .object({
    dataInizio: isoInstant,
    dataFinePrevista: isoInstant.nullable().optional(),
    clientId: z.string().min(1).max(100).nullable().optional(),
    vehicleId: z.string().min(1).max(100).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((b) => !b.dataFinePrevista || Date.parse(b.dataFinePrevista) >= Date.parse(b.dataInizio), {
    message: "La fine prevista non può precedere l'inizio",
    path: ["dataFinePrevista"],
  });

// Assegnazione / consegna al cliente.
export const assignSchema = z
  .object({
    clientId: z.string().min(1).max(100),
    vehicleId: z.string().min(1).max(100).nullable().optional(),
    dataConsegna: isoInstant.optional(),
    dataFinePrevista: isoInstant.nullable().optional(),
    kmIniziali: km.nullable().optional(),
    carburanteIniziale: fuelLevel.nullable().optional(),
    fotoConsegna: z.array(photoSchema).max(50).optional(),
    firmaClienteDataUrl: z.string().max(2000000).nullable().optional(),
    firmatarioNome: z.string().trim().max(200).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    attribuitaAllaPratica: z.boolean().optional(),
  })
  .strict();

// Rientro / restituzione.
export const returnSchema = z
  .object({
    dataRestituzione: isoInstant.optional(),
    kmFinali: km.nullable().optional(),
    carburanteFinale: fuelLevel.nullable().optional(),
    fotoRestituzione: z.array(photoSchema).max(50).optional(),
    danni: z.array(damageSchema).max(50).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    attribuitaAllaPratica: z.boolean().optional(),
  })
  .strict();

// Modifica campi liberi di una prenotazione (es. collegamento pratica,
// flag di addebito) senza cambiare fase del ciclo di vita.
export const bookingPatchSchema = z
  .object({
    clientId: z.string().min(1).max(100).nullable().optional(),
    vehicleId: z.string().min(1).max(100).nullable().optional(),
    dataInizio: isoInstant.optional(),
    dataFinePrevista: isoInstant.nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    attribuitaAllaPratica: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------
// Costo interno
// ---------------------------------------------------------------
// Giorni fatturati: periodi di 24h arrotondati per eccesso, minimo 1.
export function billedDays(start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 1;
  return Math.max(1, Math.ceil((e - s) / MS_PER_DAY));
}

export function computeBookingCostCents(costoGiornalieroCents, start, end) {
  const rate = Number(costoGiornalieroCents) || 0;
  if (rate <= 0 || !start || !end) return 0;
  return rate * billedDays(start, end);
}

// ---------------------------------------------------------------
// Sovrapposizioni di prenotazione
// ---------------------------------------------------------------
// Una prenotazione senza fine è considerata aperta (fine all'infinito).
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  const as = new Date(aStart).getTime();
  const ae = aEnd ? new Date(aEnd).getTime() : Infinity;
  const bs = new Date(bStart).getTime();
  const be = bEnd ? new Date(bEnd).getTime() : Infinity;
  return as < be && bs < ae;
}

function bookingEnd(b) {
  return b.dataRestituzione ?? b.dataFinePrevista ?? null;
}

// Restituisce le prenotazioni attive che si sovrappongono alla finestra data.
export function findBookingOverlaps(existingBookings = [], { start, end, ignoreId = null } = {}) {
  return existingBookings.filter(
    (b) =>
      b.id !== ignoreId &&
      BOOKING_ATTIVE.includes(b.stato) &&
      intervalsOverlap(start, end, b.dataInizio, bookingEnd(b))
  );
}

// ---------------------------------------------------------------
// Alert flotta
// ---------------------------------------------------------------
function daysUntil(dateValue, now) {
  const t = new Date(dateValue).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / MS_PER_DAY);
}

function scadenzaAlert(code, label, dateValue, now, soglia) {
  if (!dateValue) return null;
  const d = daysUntil(dateValue, now);
  if (d === null) return null;
  if (d < 0) return { code: `${code}_SCADUTA`, level: "critical", message: `⚠️ ${label} scaduta da ${Math.abs(d)} giorni` };
  if (d <= soglia) return { code: `${code}_IN_SCADENZA`, level: "warn", message: `⚠️ ${label} in scadenza tra ${d} giorni` };
  return null;
}

// Alert di una singola auto: assicurazione, revisione, manutenzione (data e km).
export function carAlerts(car, { now = new Date(), soglia = ALERT_DEFAULTS } = {}) {
  const alerts = [];
  const a = scadenzaAlert("ASSICURAZIONE", "Assicurazione", car.assicurazioneScadenza, now, soglia.scadenzaGiorni);
  if (a) alerts.push(a);
  const r = scadenzaAlert("REVISIONE", "Revisione", car.revisioneScadenza, now, soglia.scadenzaGiorni);
  if (r) alerts.push(r);
  const m = scadenzaAlert("MANUTENZIONE", "Manutenzione", car.manutenzioneScadenza, now, soglia.scadenzaGiorni);
  if (m) alerts.push(m);
  if (car.manutenzioneKm != null && car.km != null) {
    const mancano = car.manutenzioneKm - car.km;
    if (mancano <= 0) alerts.push({ code: "MANUTENZIONE_KM_SUPERATI", level: "critical", message: `⚠️ Manutenzione: superati i km previsti (${Math.abs(mancano)} km oltre)` });
    else if (mancano <= soglia.manutenzioneKm) alerts.push({ code: "MANUTENZIONE_KM_VICINA", level: "warn", message: `⚠️ Manutenzione tra ${mancano} km` });
  }
  return alerts;
}

// Alert dell'intera flotta: per-auto + sovrapposizioni di prenotazione.
export function fleetAlerts(cars = [], bookingsByCar = {}, { now = new Date(), soglia = ALERT_DEFAULTS } = {}) {
  const result = [];
  for (const car of cars) {
    if (car.attiva === false) continue;
    const alerts = carAlerts(car, { now, soglia });
    const bookings = (bookingsByCar[car.id] || []).filter((b) => BOOKING_ATTIVE.includes(b.stato));
    const overlaps = detectOverlapPairs(bookings);
    for (const [x, y] of overlaps) {
      alerts.push({
        code: "PRENOTAZIONI_SOVRAPPOSTE",
        level: "critical",
        message: `⚠️ Prenotazioni sovrapposte (${day(x.dataInizio)} e ${day(y.dataInizio)})`,
        bookingIds: [x.id, y.id],
      });
    }
    if (alerts.length) result.push({ carId: car.id, targa: car.targa, marca: car.marca, modello: car.modello, alerts });
  }
  return result;
}

// Coppie di prenotazioni che si sovrappongono nello stesso veicolo.
export function detectOverlapPairs(bookings = []) {
  const active = bookings.filter((b) => BOOKING_ATTIVE.includes(b.stato));
  const pairs = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (intervalsOverlap(active[i].dataInizio, bookingEnd(active[i]), active[j].dataInizio, bookingEnd(active[j]))) {
        pairs.push([active[i], active[j]]);
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------
// Profit Tracker: costo auto sostitutiva attribuito alla pratica
// ---------------------------------------------------------------
// Aggiunge un costo automatico (categoria "sostitutiva") al registro della
// pratica per ogni prenotazione con addebito attivo e costo calcolato.
// Stesso schema usato da parts-tracking: la riga automatica non è modificabile
// a mano ma è sempre tracciabile fino alla prenotazione di origine.
export function loanerProfitData(data, bookings = []) {
  const automaticCosts = [];
  for (const b of bookings) {
    if (!b.attribuitaAllaPratica || b.costoTotaleCents == null) continue;
    const carLabel = b.loanerCar ? ` ${b.loanerCar.marca} ${b.loanerCar.modello} · ${b.loanerCar.targa}` : "";
    automaticCosts.push({
      id: `loaner:${b.id}`,
      category: "sostitutiva",
      phase: "actual",
      date: day(b.dataRestituzione ?? b.dataConsegna ?? b.dataInizio ?? b.createdAt),
      description: `Auto sostitutiva${carLabel}`.trim(),
      quantity: 1,
      unitCents: b.costoTotaleCents,
    });
  }
  return { data: { ...data, costs: [...data.costs, ...automaticCosts] }, automaticCosts };
}

// ---------------------------------------------------------------
// Calendario disponibilità
// ---------------------------------------------------------------
// Una prenotazione copre un giorno (stringa YYYY-MM-DD) se il giorno cade
// nella finestra [inizio, fine]; una prenotazione aperta copre da inizio in poi.
export function bookingCoversDay(booking, dayStr) {
  const start = day(booking.dataInizio);
  const endValue = booking.dataRestituzione ?? booking.dataFinePrevista ?? null;
  const end = endValue ? day(endValue) : null;
  if (!start) return false;
  if (dayStr < start) return false;
  if (end && dayStr > end) return false;
  return true;
}

// Costruisce una griglia auto × giorni con lo stato occupato/libero per cella.
export function buildCalendar(cars = [], bookings = [], days = []) {
  const activeCars = cars.filter((c) => c.attiva !== false);
  const byCar = {};
  for (const b of bookings) {
    if (!BOOKING_ATTIVE.includes(b.stato)) continue;
    (byCar[b.loanerCarId] ||= []).push(b);
  }
  return {
    days,
    rows: activeCars.map((car) => ({
      carId: car.id,
      targa: car.targa,
      marca: car.marca,
      modello: car.modello,
      stato: car.stato,
      cells: days.map((d) => {
        const booking = (byCar[car.id] || []).find((b) => bookingCoversDay(b, d));
        return { day: d, occupata: Boolean(booking), bookingId: booking?.id ?? null, stato: booking?.stato ?? null };
      }),
    })),
  };
}
