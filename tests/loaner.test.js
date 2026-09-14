import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billedDays, computeBookingCostCents,
  intervalsOverlap, findBookingOverlaps, detectOverlapPairs,
  carAlerts, fleetAlerts,
  loanerProfitData, buildCalendar, bookingCoversDay,
  carCreateSchema, bookingCreateSchema, assignSchema, returnSchema, bookingPatchSchema,
} from '../src/lib/loaner.js';

test('billedDays: periodi di 24h arrotondati per eccesso, minimo 1', () => {
  assert.equal(billedDays('2026-09-14T09:00:00Z', '2026-09-14T09:00:00Z'), 1);
  assert.equal(billedDays('2026-09-14T09:00:00Z', '2026-09-14T18:00:00Z'), 1);
  assert.equal(billedDays('2026-09-14T09:00:00Z', '2026-09-15T09:00:00Z'), 1);
  assert.equal(billedDays('2026-09-14T09:00:00Z', '2026-09-15T10:00:00Z'), 2);
  assert.equal(billedDays('2026-09-14T09:00:00Z', '2026-09-17T09:00:00Z'), 3);
});

test('computeBookingCostCents: tariffa × giorni, 0 se tariffa nulla', () => {
  assert.equal(computeBookingCostCents(2500, '2026-09-14T09:00:00Z', '2026-09-17T09:00:00Z'), 7500);
  assert.equal(computeBookingCostCents(0, '2026-09-14T09:00:00Z', '2026-09-17T09:00:00Z'), 0);
  assert.equal(computeBookingCostCents(2500, null, null), 0);
});

test('intervalsOverlap: finestre e prenotazioni aperte', () => {
  assert.equal(intervalsOverlap('2026-09-14', '2026-09-16', '2026-09-15', '2026-09-17'), true);
  assert.equal(intervalsOverlap('2026-09-14', '2026-09-16', '2026-09-16', '2026-09-18'), false); // adiacenti
  assert.equal(intervalsOverlap('2026-09-14', null, '2026-09-20', '2026-09-21'), true); // aperta copre il futuro
});

test('findBookingOverlaps: solo prenotazioni attive, esclude sé stessa', () => {
  const existing = [
    { id: 'a', stato: 'ASSEGNATA', dataInizio: '2026-09-14', dataFinePrevista: '2026-09-16' },
    { id: 'b', stato: 'ANNULLATA', dataInizio: '2026-09-15', dataFinePrevista: '2026-09-18' },
    { id: 'c', stato: 'RESTITUITA', dataInizio: '2026-09-15', dataRestituzione: '2026-09-18' },
  ];
  assert.deepEqual(findBookingOverlaps(existing, { start: '2026-09-15', end: '2026-09-20' }).map(b => b.id), ['a']);
  assert.deepEqual(findBookingOverlaps(existing, { start: '2026-09-15', end: '2026-09-20', ignoreId: 'a' }), []);
  assert.deepEqual(findBookingOverlaps(existing, { start: '2026-09-16', end: '2026-09-20' }), []); // adiacente ad 'a'
});

test('detectOverlapPairs: individua coppie sovrapposte', () => {
  const pairs = detectOverlapPairs([
    { id: 'a', stato: 'PRENOTATA', dataInizio: '2026-09-14', dataFinePrevista: '2026-09-16' },
    { id: 'b', stato: 'ASSEGNATA', dataInizio: '2026-09-15', dataFinePrevista: '2026-09-17' },
    { id: 'c', stato: 'PRENOTATA', dataInizio: '2026-09-20', dataFinePrevista: '2026-09-21' },
  ]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].map(b => b.id).sort(), ['a', 'b']);
});

test('carAlerts: assicurazione, revisione, manutenzione (data e km)', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const car = {
    assicurazioneScadenza: '2026-09-09T00:00:00Z', // scaduta 5 gg
    revisioneScadenza: '2026-09-24T00:00:00Z', // tra 10 gg
    manutenzioneScadenza: '2027-01-01T00:00:00Z', // lontana
    km: 99600, manutenzioneKm: 100000, // mancano 400 km
  };
  const codes = carAlerts(car, { now }).map(a => a.code);
  assert.ok(codes.includes('ASSICURAZIONE_SCADUTA'));
  assert.ok(codes.includes('REVISIONE_IN_SCADENZA'));
  assert.ok(codes.includes('MANUTENZIONE_KM_VICINA'));
  assert.ok(!codes.includes('MANUTENZIONE_IN_SCADENZA'));

  const superati = carAlerts({ km: 100500, manutenzioneKm: 100000 }, { now }).map(a => a.code);
  assert.ok(superati.includes('MANUTENZIONE_KM_SUPERATI'));

  assert.deepEqual(carAlerts({}, { now }), []);
});

test('fleetAlerts: aggrega alert auto + sovrapposizioni', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const cars = [
    { id: 'c1', targa: 'AA111AA', marca: 'Fiat', modello: 'Panda', attiva: true, revisioneScadenza: '2026-09-01T00:00:00Z' },
    { id: 'c2', targa: 'BB222BB', marca: 'VW', modello: 'Polo', attiva: true },
    { id: 'c3', targa: 'CC333CC', marca: 'Ford', modello: 'Ka', attiva: false, revisioneScadenza: '2020-01-01T00:00:00Z' },
  ];
  const bookingsByCar = {
    c2: [
      { id: 'x', stato: 'PRENOTATA', dataInizio: '2026-09-14', dataFinePrevista: '2026-09-16' },
      { id: 'y', stato: 'ASSEGNATA', dataInizio: '2026-09-15', dataFinePrevista: '2026-09-17' },
    ],
  };
  const result = fleetAlerts(cars, bookingsByCar, { now });
  const c1 = result.find(r => r.carId === 'c1');
  const c2 = result.find(r => r.carId === 'c2');
  assert.ok(c1.alerts.some(a => a.code === 'REVISIONE_SCADUTA'));
  assert.ok(c2.alerts.some(a => a.code === 'PRENOTAZIONI_SOVRAPPOSTE'));
  assert.ok(!result.some(r => r.carId === 'c3')); // auto dismessa esclusa
});

test('loanerProfitData: inietta il costo solo se attribuito e calcolato', () => {
  const data = { costs: [{ id: 'm1', category: 'ricambi', phase: 'actual', date: '2026-09-10', description: 'x', quantity: 1, unitCents: 100 }] };
  const bookings = [
    { id: 'b1', attribuitaAllaPratica: true, costoTotaleCents: 7500, dataRestituzione: '2026-09-12T09:00:00Z', loanerCar: { marca: 'Fiat', modello: 'Panda', targa: 'AB123CD' } },
    { id: 'b2', attribuitaAllaPratica: false, costoTotaleCents: 5000 },
    { id: 'b3', attribuitaAllaPratica: true, costoTotaleCents: null },
  ];
  const { data: merged, automaticCosts } = loanerProfitData(data, bookings);
  assert.equal(automaticCosts.length, 1);
  assert.equal(automaticCosts[0].category, 'sostitutiva');
  assert.equal(automaticCosts[0].phase, 'actual');
  assert.equal(automaticCosts[0].unitCents, 7500);
  assert.equal(automaticCosts[0].id, 'loaner:b1');
  assert.ok(automaticCosts[0].description.includes('AB123CD'));
  assert.equal(merged.costs.length, 2); // originale + automatico
});

test('buildCalendar / bookingCoversDay: celle occupate nella finestra', () => {
  const booking = { id: 'bk', loanerCarId: 'c1', stato: 'ASSEGNATA', dataInizio: '2026-09-14T09:00:00Z', dataFinePrevista: '2026-09-16T09:00:00Z' };
  assert.equal(bookingCoversDay(booking, '2026-09-14'), true);
  assert.equal(bookingCoversDay(booking, '2026-09-16'), true);
  assert.equal(bookingCoversDay(booking, '2026-09-17'), false);
  const cal = buildCalendar(
    [{ id: 'c1', targa: 'AA111AA', marca: 'Fiat', modello: 'Panda', stato: 'ASSEGNATA', attiva: true }],
    [booking],
    ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']
  );
  assert.equal(cal.rows.length, 1);
  assert.deepEqual(cal.rows[0].cells.map(c => c.occupata), [true, true, true, false]);
});

test('schemi di validazione', () => {
  assert.equal(carCreateSchema.safeParse({ targa: 'AB123CD', marca: 'Fiat', modello: 'Panda' }).success, true);
  assert.equal(carCreateSchema.safeParse({ targa: 'AB123CD', marca: 'Fiat', modello: 'Panda', carburante: 'NUCLEARE' }).success, false);
  assert.equal(carCreateSchema.safeParse({ marca: 'Fiat', modello: 'Panda' }).success, false); // targa mancante

  assert.equal(bookingCreateSchema.safeParse({ dataInizio: '2026-09-14T09:00:00Z' }).success, true);
  assert.equal(bookingCreateSchema.safeParse({ dataInizio: '2026-09-16T09:00:00Z', dataFinePrevista: '2026-09-14T09:00:00Z' }).success, false); // fine < inizio

  assert.equal(assignSchema.safeParse({ clientId: 'cl1', kmIniziali: 1000, carburanteIniziale: 80 }).success, true);
  assert.equal(assignSchema.safeParse({ carburanteIniziale: 80 }).success, false); // clientId obbligatorio
  assert.equal(assignSchema.safeParse({ clientId: 'cl1', carburanteIniziale: 120 }).success, false); // >100

  assert.equal(returnSchema.safeParse({ kmFinali: 1200, danni: [{ descrizione: 'graffio', gravita: 'LIEVE' }] }).success, true);
  assert.equal(returnSchema.safeParse({ danni: [{ gravita: 'LIEVE' }] }).success, false); // descrizione mancante

  assert.equal(bookingPatchSchema.safeParse({ attribuitaAllaPratica: true, vehicleId: 'v1' }).success, true);
});
