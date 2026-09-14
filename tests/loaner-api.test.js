import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma.js';
import { loanerCarsRouter } from '../src/routes/loanerCars.js';

process.env.JWT_SECRET = 'isolated-loaner-test';

// ---- In-memory Prisma double (no DB connection) ----------------------------
const db = { loanerCar: [], loanerBooking: [], client: [], vehicle: [] };
let seq = 0;
const id = (p) => `${p}-${++seq}`;

function matches(item, where = {}) {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('in' in v) { if (!v.in.includes(item[k])) return false; }
      else if ('not' in v) { if (item[k] === v.not) return false; }
      else return false;
    } else if (item[k] !== v) return false;
  }
  return true;
}
function sortBy(list, orderBy) {
  if (!orderBy) return list;
  const [key, dir] = Object.entries(orderBy)[0];
  return [...list].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
}
function decorateBooking(b, include) {
  if (!b || !include) return b;
  const out = { ...b };
  if (include.client) out.client = db.client.find((c) => c.id === b.clientId) ?? null;
  if (include.vehicle) out.vehicle = db.vehicle.find((v) => v.id === b.vehicleId) ?? null;
  if (include.loanerCar) out.loanerCar = db.loanerCar.find((c) => c.id === b.loanerCarId) ?? null;
  return out;
}
function decorateCar(car, include) {
  if (!car || !include) return car;
  const out = { ...car };
  if (include.bookings) {
    let list = db.loanerBooking.filter((b) => b.loanerCarId === car.id);
    if (include.bookings.where) list = list.filter((b) => matches(b, include.bookings.where));
    list = sortBy(list, include.bookings.orderBy);
    out.bookings = list.map((b) => decorateBooking(b, include.bookings.include));
  }
  if (include._count) out._count = { bookings: db.loanerBooking.filter((b) => b.loanerCarId === car.id).length };
  return out;
}
function collection(name, decorate, defaults = {}) {
  return {
    findMany: async ({ where, orderBy, include } = {}) =>
      sortBy(db[name].filter((i) => matches(i, where)), orderBy).map((i) => decorate ? decorate(i, include) : i),
    findFirst: async ({ where, include } = {}) => {
      const found = db[name].find((i) => matches(i, where)) ?? null;
      return decorate ? decorate(found, include) : found;
    },
    findUnique: async ({ where, include } = {}) => {
      const found = db[name].find((i) => i.id === where.id) ?? null;
      return decorate ? decorate(found, include) : found;
    },
    create: async ({ data, include }) => {
      const row = { id: id(name), ...defaults, ...data };
      db[name].push(row);
      return decorate ? decorate(row, include) : row;
    },
    update: async ({ where, data, include }) => {
      const row = db[name].find((i) => i.id === where.id);
      Object.assign(row, data);
      return decorate ? decorate(row, include) : row;
    },
    updateMany: async ({ where, data }) => {
      const rows = db[name].filter((i) => matches(i, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    delete: async ({ where }) => {
      const i = db[name].findIndex((x) => x.id === where.id);
      const [row] = db[name].splice(i, 1);
      return row;
    },
    deleteMany: async ({ where }) => {
      const keep = db[name].filter((i) => !matches(i, where));
      const removed = db[name].length - keep.length;
      db[name] = keep;
      return { count: removed };
    },
  };
}
Object.assign(prisma, {
  loanerCar: collection('loanerCar', decorateCar, { attiva: true, stato: 'DISPONIBILE', km: null }),
  loanerBooking: collection('loanerBooking', decorateBooking, { costoTotaleCents: null }),
  client: collection('client'),
  vehicle: collection('vehicle'),
  $transaction: async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
});

// Seed cross-tenant refs.
db.client.push({ id: 'client-a', tenantId: 'tenant-a', nome: 'Luca', cognome: 'Bianchi', telefono: '333' });
db.vehicle.push({ id: 'vehicle-a', tenantId: 'tenant-a', marca: 'Fiat', modello: 'Punto', targa: 'ZZ999ZZ' });

const app = express();
app.use(express.json());
app.use('/api/loaner-cars', loanerCarsRouter);
app.use((err, req, res, next) => res.status(500).json({ error: String(err?.message || err) }));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/api/loaner-cars`;
const token = (tenantId = 'tenant-a') => jwt.sign({ sub: 'user-a', tenantId, role: 'ADMIN' }, process.env.JWT_SECRET);
const call = (path, method = 'GET', body, tenantId = 'tenant-a') =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tenantId ? { Authorization: 'Bearer ' + token(tenantId) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test('Auto sostitutive API: flotta, prenotazioni, assegnazione, rientro, costo, alert', async () => {
  try {
    // Auth obbligatoria
    assert.equal((await call('/', 'GET', null, null)).status, 401);

    // Crea auto con tariffa giornaliera 25€/g
    const car = await (await call('/', 'POST', { targa: 'AB123CD', marca: 'Fiat', modello: 'Panda', km: 50000, carburante: 'BENZINA', costoGiornalieroCents: 2500 })).json();
    assert.equal(car.stato, 'DISPONIBILE');
    assert.equal(car.costoGiornalieroCents, 2500);

    // Lista flotta
    const lista = await (await call('/')).json();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].alerts.length, 0);

    // Prenotazione A [14→16]
    const bookingA = await (await call(`/${car.id}/bookings`, 'POST', { dataInizio: '2026-09-14T09:00:00Z', dataFinePrevista: '2026-09-16T09:00:00Z' })).json();
    assert.equal(bookingA.stato, 'PRENOTATA');
    assert.equal((await (await call(`/${car.id}`)).json()).stato, 'PRENOTATA');

    // Prenotazione B sovrapposta → 409
    assert.equal((await call(`/${car.id}/bookings`, 'POST', { dataInizio: '2026-09-15T09:00:00Z', dataFinePrevista: '2026-09-18T09:00:00Z' })).status, 409);

    // Assegna con cliente inesistente → 400
    assert.equal((await call(`/${car.id}/bookings/${bookingA.id}/assegna`, 'PATCH', { clientId: 'ghost' })).status, 400);

    // Assegna alla pratica, con km/carburante iniziali e firma
    const assigned = await (await call(`/${car.id}/bookings/${bookingA.id}/assegna`, 'PATCH', {
      clientId: 'client-a', vehicleId: 'vehicle-a', dataConsegna: '2026-09-14T09:00:00Z',
      kmIniziali: 50000, carburanteIniziale: 90, firmaClienteDataUrl: 'data:image/png;base64,AAAA', firmatarioNome: 'Luca Bianchi',
      attribuitaAllaPratica: true,
    })).json();
    assert.equal(assigned.stato, 'ASSEGNATA');
    assert.equal(assigned.client.nome, 'Luca');
    assert.equal(assigned.vehicle.targa, 'ZZ999ZZ');
    assert.ok(assigned.firmaAt);
    assert.equal((await (await call(`/${car.id}`)).json()).stato, 'ASSEGNATA');

    // km finali < iniziali → 400
    assert.equal((await call(`/${car.id}/bookings/${bookingA.id}/restituzione`, 'PATCH', { kmFinali: 49000 })).status, 400);

    // Rientro dopo 3 giorni (14→17) = 3 giorni × 2500 = 7500
    const returned = await (await call(`/${car.id}/bookings/${bookingA.id}/restituzione`, 'PATCH', {
      dataRestituzione: '2026-09-17T09:00:00Z', kmFinali: 50420, carburanteFinale: 60,
      danni: [{ descrizione: 'Graffio paraurti', gravita: 'LIEVE' }], note: 'Tutto ok',
    })).json();
    assert.equal(returned.stato, 'RESTITUITA');
    assert.equal(returned.costoTotaleCents, 7500);

    // Auto torna disponibile, km aggiornati
    const afterReturn = await (await call(`/${car.id}`)).json();
    assert.equal(afterReturn.stato, 'DISPONIBILE');
    assert.equal(afterReturn.km, 50420);

    // Alert su revisione scaduta dopo PATCH
    await call(`/${car.id}`, 'PATCH', { revisioneScadenza: '2020-01-01T00:00:00Z' });
    const alerts = await (await call('/alerts')).json();
    assert.ok(alerts.some((a) => a.carId === car.id && a.alerts.some((x) => x.code === 'REVISIONE_SCADUTA')));

    // Calendario disponibilità
    const cal = await (await call('/calendar?from=2026-09-14&to=2026-09-17')).json();
    assert.equal(cal.days.length, 4);
    assert.equal(cal.rows.length, 1);

    // Isolamento multi-tenant: altro tenant non vede l'auto
    assert.equal((await call(`/${car.id}`, 'GET', null, 'tenant-b')).status, 404);

    // Elimina auto con storico → 409 (dismettere invece)
    assert.equal((await call(`/${car.id}`, 'DELETE')).status, 409);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
