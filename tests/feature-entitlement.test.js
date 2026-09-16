// Punto 29 (test automatici, "feature entitlement"): verifica che
// requireFeature blocchi davvero l'accesso a una funzione non inclusa
// nel piano del tenant, e lo conceda quando lo è — con l'app costruita
// come in index.js (middleware + router), non solo il router isolato,
// altrimenti il test non passerebbe mai dal middleware sotto esame.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-feature-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { requireFeature } = await import("../src/middleware/feature.js");
const { requireAuth } = await import("../src/middleware/auth.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/damage-items", requireFeature("ai_damage"), requireAuth, (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Feature entitlement: blocca/concede l'accesso in base al piano del tenant", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (token) => fetch(`${base}/api/damage-items`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  const suffix = Date.now();
  const created = [];
  const passwordHash = await bcrypt.hash("Test1234!", 10);

  async function creaTenant(overrides) {
    const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Feature Test ${suffix} ${Math.random()}`, ...overrides } });
    const user = await prisma.user.create({ data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `feat.${suffix}.${Math.random()}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    created.push(tenant.id);
    return jwt.sign({ sub: user.id, tenantId: tenant.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  }

  try {
    await t.test("piano STARTER: ai_damage non incluso, 403", async () => {
      const token = await creaTenant({ piano: "STARTER" });
      const res = await call(token);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.featureRequired, "ai_damage");
    });

    await t.test("piano PRO: ai_damage non incluso (solo Premium AI), 403", async () => {
      const token = await creaTenant({ piano: "PRO" });
      const res = await call(token);
      assert.equal(res.status, 403);
    });

    await t.test("piano PREMIUM_AI: ai_damage incluso, passa", async () => {
      const token = await creaTenant({ piano: "PREMIUM_AI" });
      const res = await call(token);
      assert.equal(res.status, 200);
    });

    await t.test("piano TRIAL: eredita le funzioni Pro, non quelle Premium AI — 403", async () => {
      const token = await creaTenant({ piano: "TRIAL" });
      const res = await call(token);
      assert.equal(res.status, 403);
    });

    await t.test("tenant demo: sempre esente, passa a prescindere dal piano", async () => {
      const token = await creaTenant({ piano: "STARTER", isDemo: true });
      const res = await call(token);
      assert.equal(res.status, 200);
    });
  } finally {
    for (const tenantId of created) {
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});
