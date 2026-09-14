import test from "node:test";
import assert from "node:assert/strict";
import { vociCriticheBloccanti, vociNonValutate, puoApprovare, DEFAULT_CHECKLIST } from "../src/lib/qc.js";

test("checklist di default ha 13 voci ordinate e ADAS/fari/spie sono critici", () => {
  assert.equal(DEFAULT_CHECKLIST.length, 13);
  assert.deepEqual(DEFAULT_CHECKLIST.map((v) => v.ordine), DEFAULT_CHECKLIST.map((v, i) => i));
  assert.equal(DEFAULT_CHECKLIST.find((v) => v.chiave === "adas").critico, true);
  assert.equal(DEFAULT_CHECKLIST.find((v) => v.chiave === "pulizia").critico, false);
});

test("una voce critica non conforme blocca l'approvazione", () => {
  const risultati = [
    { critico: true, esito: "OK" },
    { critico: true, esito: "NON_CONFORME" },
    { critico: false, esito: "NON_CONFORME" },
  ];
  assert.equal(vociCriticheBloccanti(risultati).length, 1);
  assert.equal(puoApprovare(risultati), false);
});

test("una voce non critica non conforme non blocca l'approvazione, se tutto il resto è valutato", () => {
  const risultati = [
    { critico: true, esito: "OK" },
    { critico: false, esito: "NON_CONFORME" },
    { critico: true, esito: "NA" },
    { critico: true, esito: "DA_VERIFICARE" },
  ];
  assert.equal(vociCriticheBloccanti(risultati).length, 0);
  assert.equal(puoApprovare(risultati), true);
});

test("una checklist non ancora completata (esito null) impedisce comunque l'approvazione", () => {
  const risultati = [{ critico: true, esito: null }, { critico: true, esito: "DA_VERIFICARE" }];
  assert.equal(vociCriticheBloccanti(risultati).length, 0);
  assert.equal(vociNonValutate(risultati).length, 1);
  assert.equal(puoApprovare(risultati), false);
});
