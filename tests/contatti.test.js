// Punto 34 (contatti commerciali): form pubblico senza autenticazione,
// con protezione spam a due livelli (rate limit + honeypot). Verifica
// con database reale che una richiesta valida crei davvero un Lead, che
// i dati non validi vengano rifiutati, che l'honeypot scarti in
// silenzio, e che il rate limit scatti oltre la soglia.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import "dotenv/config";

// Non inviare email vere durante i test, anche se RESEND_API_KEY è
// configurata nell'.env locale per l'uso manuale (trovato durante
// questo stesso punto: la notifica per ogni Lead di test arrivava
// davvero nella casella reale — vedi anche gli altri test che toccano
// rotte con invio email).
delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { contattiRouter } = await import("../src/routes/contatti.js");

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/contatti", contattiRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Contatti commerciali: crea un Lead, valida i dati, honeypot e rate limit", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const created = [];

  try {
    await t.test("dati validi: 201 e crea un Lead con origine CONTATTO e stato NUOVO", async () => {
      const email = `contatto.${suffix}@example.invalid`;
      const res = await fetch(`${base}/api/contatti`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Mario", cognome: "Rossi", carrozzeria: `Carrozzeria Test ${suffix}`,
          email, telefono: "+393331234567", numeroDipendenti: 5, messaggio: "Vorrei un preventivo",
        }),
      });
      assert.equal(res.status, 201);
      const lead = await prisma.lead.findFirst({ where: { email } });
      assert.ok(lead, "il Lead deve essere stato salvato");
      created.push(lead.id);
      assert.equal(lead.origine, "CONTATTO");
      assert.equal(lead.stato, "NUOVO");
      assert.equal(lead.carrozzeria, `Carrozzeria Test ${suffix}`);
    });

    await t.test("campi obbligatori mancanti: 400, nessun Lead creato", async () => {
      const email = `incompleto.${suffix}@example.invalid`;
      const res = await fetch(`${base}/api/contatti`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      assert.equal(res.status, 400);
      const lead = await prisma.lead.findFirst({ where: { email } });
      assert.equal(lead, null);
    });

    await t.test("email non valida: 400", async () => {
      const res = await fetch(`${base}/api/contatti`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "A", carrozzeria: "B", email: "non-una-email" }),
      });
      assert.equal(res.status, 400);
    });

    await t.test("honeypot valorizzato: risposta 201 (finta), nessun Lead creato", async () => {
      const email = `bot.${suffix}@example.invalid`;
      const res = await fetch(`${base}/api/contatti`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Bot", carrozzeria: "Spam SRL", email, sitoWeb: "http://spam.example" }),
      });
      assert.equal(res.status, 201);
      const lead = await prisma.lead.findFirst({ where: { email } });
      assert.equal(lead, null, "l'honeypot deve scartare senza salvare nulla");
    });

    await t.test("oltre il limite di richieste: 429", async () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${base}/api/contatti`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: "A", carrozzeria: "B", email: `rate.${suffix}.${i}@example.invalid` }),
        });
        results.push(res.status);
        if (res.status === 201) {
          const lead = await prisma.lead.findFirst({ where: { email: `rate.${suffix}.${i}@example.invalid` } });
          if (lead) created.push(lead.id);
        }
      }
      assert.ok(results.includes(429), "oltre la soglia deve rispondere 429: " + results);
    });
  } finally {
    server.close();
    await prisma.lead.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }
});
