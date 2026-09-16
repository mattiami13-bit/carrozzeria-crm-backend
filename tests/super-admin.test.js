// Punto 31 (seed super-admin): verifica che il meccanismo funzioni
// davvero end-to-end — login, sola visibilità sui dati di piattaforma
// (non operativi), e soprattutto i due confini di sicurezza che
// giustificano un modello/token separato da User invece di riusare
// requireAuth con un ruolo "SUPER_ADMIN":
//   1. un token super-admin (senza tenantId) deve essere rifiutato da
//      requireAuth su una rotta tenant-scoped, non silenziosamente
//      trattato come "nessun filtro tenant" (vedi middleware/auth.js);
//   2. un token utente tenant normale deve essere rifiutato da
//      requireSuperAdmin.
// Costruito come index.js (middleware + entrambi i router), non router
// isolati, altrimenti i due middleware sotto esame non entrerebbero mai
// in gioco.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-super-admin-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { requireAuth } = await import("../src/middleware/auth.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/super-admin", superAdminRouter);
  app.use("/api/clients", requireAuth, (req, res) => res.json({ ok: true, tenantId: req.auth.tenantId }));
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Super-admin: login, boundary di sicurezza, e sola-lettura sui dati di piattaforma", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const suffix = Date.now();
  const email = `super.test.${suffix}@example.invalid`;
  const password = "SuperTestPassword12345!";
  const passwordHash = await bcrypt.hash(password, 10);

  const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash } });

  const tenantPasswordHash = await bcrypt.hash("Test1234!", 10);
  const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Super Admin Test ${suffix}` } });
  const tenantUser = await prisma.user.create({
    data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `su.${suffix}@example.invalid`, passwordHash: tenantPasswordHash, ruolo: "ADMIN", emailVerificata: true },
  });
  const tenantToken = jwt.sign({ sub: tenantUser.id, tenantId: tenant.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  let leadId;

  try {
    let superAdminToken;

    await t.test("login con credenziali sbagliate: 401", async () => {
      const res = await fetch(`${base}/api/super-admin/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password-sbagliata" }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("login con credenziali corrette: 200 e token", async () => {
      const res = await fetch(`${base}/api/super-admin/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.token);
      assert.equal(data.superAdmin.email, email);
      superAdminToken = data.token;

      const payload = jwt.decode(data.token);
      assert.equal(payload.superAdmin, true);
      assert.equal(payload.tenantId, undefined, "il token super-admin non deve MAI avere un tenantId");
    });

    await t.test("token super-admin su /api/super-admin/tenants: 200, vede tutti i tenant", async () => {
      const res = await fetch(`${base}/api/super-admin/tenants`, { headers: { Authorization: `Bearer ${superAdminToken}` } });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
      assert.ok(data.some((tt) => tt.id === tenant.id), "deve includere il tenant appena creato");
      const riga = data.find((tt) => tt.id === tenant.id);
      assert.equal(riga.clients, undefined, "non deve esporre dati operativi, solo conteggi");
    });

    await t.test("token super-admin su /api/super-admin/gdpr-richieste: 200", async () => {
      const res = await fetch(`${base}/api/super-admin/gdpr-richieste`, { headers: { Authorization: `Bearer ${superAdminToken}` } });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(await res.json()));
    });

    await t.test("punto 35: GET /api/super-admin/leads vede i Lead di entrambe le origini (contatti e demo)", async () => {
      const lead = await prisma.lead.create({
        data: { nome: "Test", carrozzeria: `Lead Test ${suffix}`, email: `lead.${suffix}@example.invalid`, origine: "DEMO" },
      });
      leadId = lead.id;
      const res = await fetch(`${base}/api/super-admin/leads`, { headers: { Authorization: `Bearer ${superAdminToken}` } });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.some((l) => l.id === leadId));
    });

    await t.test("punto 35: filtro per stato funziona, stato non valido è rifiutato", async () => {
      const ok = await fetch(`${base}/api/super-admin/leads?stato=NUOVO`, { headers: { Authorization: `Bearer ${superAdminToken}` } });
      assert.equal(ok.status, 200);
      assert.ok((await ok.json()).every((l) => l.stato === "NUOVO"));

      const invalido = await fetch(`${base}/api/super-admin/leads?stato=INVENTATO`, { headers: { Authorization: `Bearer ${superAdminToken}` } });
      assert.equal(invalido.status, 400);
    });

    await t.test("punto 35: PATCH /api/super-admin/leads/:id/stato fa avanzare la pipeline (NUOVO → CONTATTATO → DEMO → TRIAL → CLIENTE)", async () => {
      for (const stato of ["CONTATTATO", "DEMO", "TRIAL", "CLIENTE"]) {
        const res = await fetch(`${base}/api/super-admin/leads/${leadId}/stato`, {
          method: "PATCH", headers: { Authorization: `Bearer ${superAdminToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ stato }),
        });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).stato, stato);
      }
    });

    await t.test("punto 35: stato non valido nel PATCH è rifiutato, Lead inesistente dà 404", async () => {
      const statoInvalido = await fetch(`${base}/api/super-admin/leads/${leadId}/stato`, {
        method: "PATCH", headers: { Authorization: `Bearer ${superAdminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "INVENTATO" }),
      });
      assert.equal(statoInvalido.status, 400);

      const nonEsistente = await fetch(`${base}/api/super-admin/leads/id-che-non-esiste/stato`, {
        method: "PATCH", headers: { Authorization: `Bearer ${superAdminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "PERSO" }),
      });
      assert.equal(nonEsistente.status, 404);
    });

    await t.test("punto 35: token tenant normale non può leggere né modificare i Lead", async () => {
      assert.equal((await fetch(`${base}/api/super-admin/leads`, { headers: { Authorization: `Bearer ${tenantToken}` } })).status, 401);
      const res = await fetch(`${base}/api/super-admin/leads/${leadId}/stato`, {
        method: "PATCH", headers: { Authorization: `Bearer ${tenantToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "PERSO" }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("BOUNDARY 1: token super-admin su rotta tenant-scoped (/api/clients) deve essere rifiutato, mai trattato come nessun filtro tenant", async () => {
      const res = await fetch(`${base}/api/clients`, { headers: { Authorization: `Bearer ${superAdminToken}` } });
      assert.equal(res.status, 401);
    });

    await t.test("BOUNDARY 2: token utente tenant normale su rotta super-admin deve essere rifiutato", async () => {
      const res = await fetch(`${base}/api/super-admin/tenants`, { headers: { Authorization: `Bearer ${tenantToken}` } });
      assert.equal(res.status, 401);
    });

    await t.test("token tenant normale continua a funzionare sulla propria rotta (sanity)", async () => {
      const res = await fetch(`${base}/api/clients`, { headers: { Authorization: `Bearer ${tenantToken}` } });
      assert.equal(res.status, 200);
    });

    await t.test("nessun token: 401 su entrambe le aree", async () => {
      assert.equal((await fetch(`${base}/api/super-admin/tenants`)).status, 401);
      assert.equal((await fetch(`${base}/api/clients`)).status, 401);
    });

    await t.test("super-admin disattivato: login rifiutato", async () => {
      await prisma.superAdmin.update({ where: { id: superAdmin.id }, data: { attivo: false } });
      const res = await fetch(`${base}/api/super-admin/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 401);
    });
  } finally {
    server.close();
    await prisma.user.delete({ where: { id: tenantUser.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
    if (leadId) await prisma.lead.delete({ where: { id: leadId } }).catch(() => {});
  }
});
