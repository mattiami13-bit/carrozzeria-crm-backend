// Punto 35 (richiesta demo): stessa logica di tests/contatti.test.js
// (punto 34), stesso modello Lead, origine DEMO invece di CONTATTO.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import "dotenv/config";

delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { demoRouter } = await import("../src/routes/demo.js");

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/demo", demoRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Richiesta demo: crea un Lead con origine DEMO, valida i dati, honeypot", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const created = [];

  try {
    await t.test("dati validi: 201 e crea un Lead con origine DEMO e stato NUOVO", async () => {
      const email = `demo.${suffix}@example.invalid`;
      const res = await fetch(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Luca", carrozzeria: `Carrozzeria Demo ${suffix}`, email, telefono: "+393339876543", numeroDipendenti: 8 }),
      });
      assert.equal(res.status, 201);
      const lead = await prisma.lead.findFirst({ where: { email } });
      assert.ok(lead);
      created.push(lead.id);
      assert.equal(lead.origine, "DEMO");
      assert.equal(lead.stato, "NUOVO");
      assert.equal(lead.numeroDipendenti, 8);
    });

    await t.test("carrozzeria mancante: 400, nessun Lead creato", async () => {
      const email = `demo-incompleto.${suffix}@example.invalid`;
      const res = await fetch(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Luca", email }),
      });
      assert.equal(res.status, 400);
      assert.equal(await prisma.lead.findFirst({ where: { email } }), null);
    });

    await t.test("honeypot valorizzato: 201 finto, nessun Lead creato", async () => {
      const email = `demo-bot.${suffix}@example.invalid`;
      const res = await fetch(`${base}/api/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Bot", carrozzeria: "Spam SRL", email, sitoWeb: "http://spam.example" }),
      });
      assert.equal(res.status, 201);
      assert.equal(await prisma.lead.findFirst({ where: { email } }), null);
    });
  } finally {
    server.close();
    await prisma.lead.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }
});
