// Punto 36 (FAQ modificabile): la pagina pubblica legge solo le voci
// attive da GET /api/faq; il super-admin gestisce contenuto/ordine/
// attivazione tramite CRUD dedicato — verifica con database reale che
// entrambe le rotte facciano davvero quello che promettono, incluso il
// confine di sicurezza (nessuno tranne il super-admin può modificare).

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

const { prisma } = await import("../src/lib/prisma.js");
const { faqRouter } = await import("../src/routes/faq.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/faq", faqRouter);
  app.use("/api/super-admin", superAdminRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("FAQ: lettura pubblica solo delle voci attive, CRUD super-admin, confine di sicurezza", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const created = [];

  const email = `super.faq.${suffix}@example.invalid`;
  const passwordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
  const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash } });

  try {
    let token;
    await t.test("login super-admin di test", async () => {
      const res = await fetch(`${base}/api/super-admin/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "SuperTestPassword12345!" }),
      });
      token = (await res.json()).token;
      assert.ok(token);
    });

    let faqId;
    await t.test("POST /api/super-admin/faq crea una voce (default attiva)", async () => {
      const res = await fetch(`${base}/api/super-admin/faq`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domanda: `Domanda test ${suffix}?`, risposta: "Risposta di test." }),
      });
      assert.equal(res.status, 201);
      const faq = await res.json();
      faqId = faq.id;
      created.push(faqId);
      assert.equal(faq.attiva, true);
    });

    await t.test("GET /api/faq (pubblica, senza token) include la voce attiva appena creata", async () => {
      const res = await fetch(`${base}/api/faq`);
      assert.equal(res.status, 200);
      const faq = await res.json();
      assert.ok(faq.some((f) => f.id === faqId));
    });

    await t.test("PATCH disattiva la voce: sparisce da GET /api/faq ma resta in GET /api/super-admin/faq", async () => {
      const res = await fetch(`${base}/api/super-admin/faq/${faqId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ attiva: false }),
      });
      assert.equal(res.status, 200);

      const pubblica = await (await fetch(`${base}/api/faq`)).json();
      assert.ok(!pubblica.some((f) => f.id === faqId), "una voce disattivata non deve comparire pubblicamente");

      const tutte = await (await fetch(`${base}/api/super-admin/faq`, { headers: { Authorization: `Bearer ${token}` } })).json();
      assert.ok(tutte.some((f) => f.id === faqId), "il super-admin deve vedere anche le voci disattivate");
    });

    await t.test("modificare senza token: 401", async () => {
      const res = await fetch(`${base}/api/super-admin/faq/${faqId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risposta: "Tentativo senza autenticazione" }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("DELETE rimuove la voce; una seconda PATCH dà 404", async () => {
      const res = await fetch(`${base}/api/super-admin/faq/${faqId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 204);
      const secondo = await fetch(`${base}/api/super-admin/faq/${faqId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ risposta: "x" }),
      });
      assert.equal(secondo.status, 404);
      created.splice(created.indexOf(faqId), 1);
    });

    await t.test("dati non validi (domanda vuota) vengono rifiutati", async () => {
      const res = await fetch(`${base}/api/super-admin/faq`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domanda: "", risposta: "x" }),
      });
      assert.equal(res.status, 400);
    });
  } finally {
    server.close();
    if (created.length) await prisma.faqItem.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
  }
});
