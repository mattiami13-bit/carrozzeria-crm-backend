import test from "node:test";
import assert from "node:assert/strict";
import { oreReali, scostamento, aggregaKpi } from "../src/lib/work-orders.js";

test("ore reali somma solo segmenti chiusi, salvo richiesta esplicita per quello in corso", () => {
  const entries = [
    { inizio: "2026-09-14T08:00:00Z", fine: "2026-09-14T10:00:00Z" }, // 2h
    { inizio: "2026-09-14T11:00:00Z", fine: "2026-09-14T11:30:00Z" }, // 0.5h
    { inizio: "2026-09-14T12:00:00Z", fine: null }, // in corso, non ancora concluso
  ];
  assert.equal(oreReali(entries), 2.5);
  const conInCorso = oreReali(entries, { includiInCorso: true, ora: new Date("2026-09-14T12:45:00Z") });
  assert.equal(conInCorso, 3.25);
});

test("ore reali non va mai sotto zero anche con timestamp incoerenti", () => {
  const entries = [{ inizio: "2026-09-14T10:00:00Z", fine: "2026-09-14T09:00:00Z" }];
  assert.equal(oreReali(entries), 0);
});

test("scostamento è la differenza reale-previsto, positivo se si è superata la stima", () => {
  assert.equal(scostamento(5, 6.5), 1.5);
  assert.equal(scostamento(5, 3), -2);
});

test("aggregaKpi somma per tecnico senza inventare soglie di giudizio", () => {
  const workOrders = [
    { tecnicoId: "t1", stato: "COMPLETATA", oreStimate: 3, timeEntries: [{ inizio: "2026-09-14T08:00:00Z", fine: "2026-09-14T11:30:00Z" }] },
    { tecnicoId: "t1", stato: "IN_CORSO", oreStimate: 2, timeEntries: [{ inizio: "2026-09-14T13:00:00Z", fine: null }] },
    { tecnicoId: "t2", stato: "COMPLETATA", oreStimate: 4, timeEntries: [{ inizio: "2026-09-14T08:00:00Z", fine: "2026-09-14T12:00:00Z" }] },
  ];
  const kpi = aggregaKpi(workOrders, (wo) => wo.tecnicoId, (wo) => wo.tecnicoId);
  const t1 = kpi.find((k) => k.key === "t1");
  const t2 = kpi.find((k) => k.key === "t2");
  assert.equal(t1.lavorazioni, 2);
  assert.equal(t1.completate, 1);
  assert.equal(t1.oreStimateTot, 5);
  assert.equal(t1.oreRealiTot, 3.5); // il segmento aperto non conta senza includiInCorso
  assert.equal(t1.scostamentoTot, -1.5);
  assert.equal(t2.oreRealiTot, 4);
  assert.equal(t2.scostamentoTot, 0);
  assert.ok(!("punteggio" in t1) && !("voto" in t1) && !("ranking" in t1));
});
