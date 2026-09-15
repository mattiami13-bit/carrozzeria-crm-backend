// Punto 24 (monitoring): health endpoint che verifica davvero il
// database, ed endpoint di segnalazione errori frontend con validazione
// e limite di frequenza.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import "dotenv/config";

const { statoSalute } = await import("../src/lib/health.js");
const { clientErrorsRouter } = await import("../src/routes/clientErrors.js");

test("Health: verifica davvero il database, non risponde sempre ok a prescindere", async () => {
  const stato = await statoSalute();
  assert.equal(stato.ok, true);
  assert.equal(stato.dipendenze.database.ok, true);
  assert.ok(typeof stato.dipendenze.database.latenzaMs === "number");
  assert.ok(Array.isArray(stato.workers));
  assert.equal(typeof stato.manutenzione, "boolean");
});

test("Errori frontend: accetta una segnalazione valida, rifiuta campi non previsti", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api/client-errors", clientErrorsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await t.test("segnalazione valida: 204", async () => {
      const res = await fetch(`${base}/api/client-errors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messaggio: "TypeError: x is undefined", stack: "at app.js:42" }),
      });
      assert.equal(res.status, 204);
    });

    await t.test("campo non previsto: rifiutata (non è un canale per dati arbitrari)", async () => {
      const res = await fetch(`${base}/api/client-errors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messaggio: "x", chiaveArbitraria: "y" }),
      });
      assert.equal(res.status, 400);
    });

    await t.test("messaggio mancante: rifiutata", async () => {
      const res = await fetch(`${base}/api/client-errors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});
