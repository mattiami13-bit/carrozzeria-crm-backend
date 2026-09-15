// Punto 23 (subscription required): verifica che un tenant con trial
// scaduto o abbonamento in stato negativo (CANCELED/UNPAID/SUSPENDED)
// venga bloccato con 402 sulle rotte operative, ma NON su auth/billing,
// e che un tenant regolare (trial attivo) non venga mai toccato.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-subscription-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { requireAbbonamentoAttivo } = await import("../src/middleware/subscription.js");
const { requireAuth } = await import("../src/middleware/auth.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", (req, res) => res.json({ esente: true })); // simula authRouter: sempre raggiungibile
  app.use("/api", requireAbbonamentoAttivo);
  app.get("/api/clients", requireAuth, (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Subscription enforcement: blocca solo i tenant senza abbonamento attivo", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token) => fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  const suffix = Date.now();
  const created = [];
  const passwordHash = await bcrypt.hash("Test1234!", 10);

  async function creaTenant(overrides) {
    const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Sub Test ${suffix} ${Math.random()}`, ...overrides } });
    const user = await prisma.user.create({ data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `sub.${suffix}.${Math.random()}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    created.push(tenant.id);
    return jwt.sign({ sub: user.id, tenantId: tenant.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  }

  try {
    await t.test("trial attivo (non scaduto): passa", async () => {
      const token = await creaTenant({ piano: "TRIAL", subscriptionStatus: "TRIALING", trialEndsAt: new Date(Date.now() + 86400000) });
      const res = await call("/api/clients", token);
      assert.equal(res.status, 200);
    });

    await t.test("trial scaduto: bloccato con 402", async () => {
      const token = await creaTenant({ piano: "TRIAL", subscriptionStatus: "TRIALING", trialEndsAt: new Date(Date.now() - 86400000) });
      const res = await call("/api/clients", token);
      assert.equal(res.status, 402);
      const data = await res.json();
      assert.equal(data.subscriptionRequired, true);
    });

    await t.test("piano attivo pagante: passa anche con trialEndsAt nel passato", async () => {
      const token = await creaTenant({ piano: "PRO", subscriptionStatus: "ACTIVE", trialEndsAt: new Date(Date.now() - 86400000) });
      const res = await call("/api/clients", token);
      assert.equal(res.status, 200);
    });

    for (const stato of ["CANCELED", "UNPAID", "SUSPENDED"]) {
      await t.test(`subscriptionStatus=${stato}: bloccato con 402`, async () => {
        const token = await creaTenant({ piano: "PRO", subscriptionStatus: stato });
        const res = await call("/api/clients", token);
        assert.equal(res.status, 402);
      });
    }

    await t.test("PAST_DUE: NON bloccato (grazia finché non diventa CANCELED/UNPAID)", async () => {
      const token = await creaTenant({ piano: "PRO", subscriptionStatus: "PAST_DUE" });
      const res = await call("/api/clients", token);
      assert.equal(res.status, 200);
    });

    await t.test("/api/auth resta raggiungibile indipendentemente dallo stato", async () => {
      const token = await creaTenant({ piano: "TRIAL", subscriptionStatus: "TRIALING", trialEndsAt: new Date(Date.now() - 86400000) });
      const res = await call("/api/auth/qualsiasi", token);
      assert.equal(res.status, 200);
    });

    await t.test("senza token: il middleware non blocca (lascia fare a requireAuth)", async () => {
      const res = await call("/api/clients", null);
      assert.equal(res.status, 401);
    });
  } finally {
    for (const tenantId of created) {
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
  }
});
