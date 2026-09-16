// Punto 39 (feature flag centralizzate): verifica i 4 livelli di
// attivazione con dati reali — nessun flag inventato lasciato acceso
// per caso (fail-closed), l'override per tenant vince sempre, e il
// CRUD è riservato al super-admin. Copre sia lib/featureFlags.js
// direttamente sia il middleware requireFlag montato su una rotta vera.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-feature-flags-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { isFeatureEnabled } = await import("../src/lib/featureFlags.js");
const { requireFlag } = await import("../src/middleware/featureFlag.js");
const { requireAuth } = await import("../src/middleware/auth.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

test("Feature flag: valutazione a 4 livelli (lib/featureFlags.js)", async (t) => {
  const suffix = `test_flag_${Date.now()}`;
  const created = [];
  const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Flag Test ${suffix}`, piano: "STARTER" } });
  created.push(tenant.id);

  try {
    await t.test("chiave inesistente: sempre false (fail-closed)", async () => {
      assert.equal(await isFeatureEnabled("chiave_mai_creata_xyz"), false);
    });

    const flagGlobale = await prisma.featureFlag.create({ data: { chiave: `${suffix}_globale`, abilitataGlobalmente: true } });
    await t.test("nessuna restrizione, globalmente attivo: true", async () => {
      assert.equal(await isFeatureEnabled(flagGlobale.chiave, { tenantId: tenant.id, piano: "STARTER" }), true);
    });

    const flagSpento = await prisma.featureFlag.create({ data: { chiave: `${suffix}_spento`, abilitataGlobalmente: false } });
    await t.test("interruttore globale spento: false", async () => {
      assert.equal(await isFeatureEnabled(flagSpento.chiave, { tenantId: tenant.id, piano: "STARTER" }), false);
    });

    const flagPiano = await prisma.featureFlag.create({ data: { chiave: `${suffix}_piano`, abilitataGlobalmente: true, piani: ["PRO", "PREMIUM_AI"] } });
    await t.test("piano non incluso: false; piano incluso: true", async () => {
      assert.equal(await isFeatureEnabled(flagPiano.chiave, { tenantId: tenant.id, piano: "STARTER" }), false);
      assert.equal(await isFeatureEnabled(flagPiano.chiave, { tenantId: tenant.id, piano: "PRO" }), true);
    });

    const flagAmbiente = await prisma.featureFlag.create({ data: { chiave: `${suffix}_ambiente`, abilitataGlobalmente: true, ambienti: ["staging"] } });
    await t.test("ambiente corrente non incluso: false", async () => {
      assert.equal(await isFeatureEnabled(flagAmbiente.chiave, { tenantId: tenant.id, piano: "STARTER" }), false);
    });

    await t.test("override per tenant vince sempre, in entrambe le direzioni", async () => {
      await prisma.featureFlagTenantOverride.create({ data: { featureFlagId: flagSpento.id, tenantId: tenant.id, abilitata: true } });
      assert.equal(await isFeatureEnabled(flagSpento.chiave, { tenantId: tenant.id, piano: "STARTER" }), true, "override deve forzare acceso anche col globale spento");

      await prisma.featureFlagTenantOverride.create({ data: { featureFlagId: flagGlobale.id, tenantId: tenant.id, abilitata: false } });
      assert.equal(await isFeatureEnabled(flagGlobale.chiave, { tenantId: tenant.id, piano: "STARTER" }), false, "override deve forzare spento anche col globale acceso");

      const altroTenant = await prisma.tenant.create({ data: { ragioneSociale: `Flag Test Altro ${suffix}`, piano: "STARTER" } });
      created.push(altroTenant.id);
      assert.equal(await isFeatureEnabled(flagGlobale.chiave, { tenantId: altroTenant.id, piano: "STARTER" }), true, "un altro tenant senza override non deve essere toccato");
    });

    await t.test("requireFlag middleware: blocca/concede sulla rotta reale", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/prova", requireFlag(flagPiano.chiave), requireAuth, (req, res) => res.json({ ok: true }));
      app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const token = jwt.sign({ sub: "u1", tenantId: tenant.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
        const bloccato = await fetch(`${base}/api/prova`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(bloccato.status, 403);
        assert.equal((await bloccato.json()).flag, flagPiano.chiave);

        await prisma.tenant.update({ where: { id: tenant.id }, data: { piano: "PRO" } });
        const concesso = await fetch(`${base}/api/prova`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(concesso.status, 200);
      } finally {
        server.close();
      }
    });
  } finally {
    await prisma.featureFlag.deleteMany({ where: { chiave: { startsWith: suffix } } });
    await prisma.tenant.deleteMany({ where: { id: { in: created } } });
  }
});

test("Feature flag: CRUD e override riservati al super-admin", async (t) => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/super-admin", superAdminRouter);
    app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
    return app;
  }
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = `crud_flag_${Date.now()}`;

  const email = `super.flags.${suffix}@example.invalid`;
  const passwordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
  const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash } });
  const tenant = await prisma.tenant.create({ data: { ragioneSociale: `CRUD Flag Test ${suffix}` } });

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

    await t.test("senza token: 401", async () => {
      const res = await fetch(`${base}/api/super-admin/feature-flags`);
      assert.equal(res.status, 401);
    });

    let flagId;
    await t.test("POST crea un flag; chiave con formato non valido è rifiutata", async () => {
      const nonValido = await fetch(`${base}/api/super-admin/feature-flags`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ chiave: "Chiave Con Spazi" }),
      });
      assert.equal(nonValido.status, 400);

      const res = await fetch(`${base}/api/super-admin/feature-flags`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ chiave: suffix, descrizione: "Flag di test", abilitataGlobalmente: false }),
      });
      assert.equal(res.status, 201);
      flagId = (await res.json()).id;
    });

    await t.test("chiave duplicata: 409", async () => {
      const res = await fetch(`${base}/api/super-admin/feature-flags`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ chiave: suffix }),
      });
      assert.equal(res.status, 409);
    });

    await t.test("PATCH accende il flag", async () => {
      const res = await fetch(`${base}/api/super-admin/feature-flags/${flagId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ abilitataGlobalmente: true }),
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).abilitataGlobalmente, true);
    });

    await t.test("PUT crea un override per tenant, GET lo mostra incluso nel flag", async () => {
      const res = await fetch(`${base}/api/super-admin/feature-flags/${flagId}/override`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, abilitata: false }),
      });
      assert.equal(res.status, 200);

      const lista = await fetch(`${base}/api/super-admin/feature-flags`, { headers: { Authorization: `Bearer ${token}` } });
      const flag = (await lista.json()).find((f) => f.id === flagId);
      assert.equal(flag.overrideTenant.length, 1);
      assert.equal(flag.overrideTenant[0].tenant.ragioneSociale, `CRUD Flag Test ${suffix}`);
    });

    await t.test("DELETE override, poi DELETE flag; una seconda PATCH dà 404", async () => {
      const delOverride = await fetch(`${base}/api/super-admin/feature-flags/${flagId}/override/${tenant.id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(delOverride.status, 204);

      const delFlag = await fetch(`${base}/api/super-admin/feature-flags/${flagId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      assert.equal(delFlag.status, 204);

      const secondo = await fetch(`${base}/api/super-admin/feature-flags/${flagId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ abilitataGlobalmente: true }),
      });
      assert.equal(secondo.status, 404);
    });
  } finally {
    server.close();
    await prisma.featureFlag.deleteMany({ where: { chiave: suffix } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
  }
});
