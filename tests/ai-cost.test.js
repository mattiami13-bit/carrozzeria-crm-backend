// Punto 41 (cost control AI): verifica con dati reali che il calcolo
// del costo sia corretto rispetto ai prezzi Anthropic reali, che
// registraCostoAi non scriva mai un costo per un modello sconosciuto
// (mai un numero inventato), e che la dashboard super-admin (COSTO AI
// OGGI, MESE, PER TENANT, PER FUNZIONE, PER PIANO) aggreghi bene.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

const { prisma } = await import("../src/lib/prisma.js");
const { calcolaCostoUsd, registraCostoAi } = await import("../src/lib/aiCost.js");
const { dashboardCostoAi } = await import("../src/lib/aiCostDashboard.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

test("calcolaCostoUsd: prezzi Sonnet 5 reali ($2/MTok input, $10/MTok output), null per modello sconosciuto", () => {
  // 1000 token input + 1000 token output = (1000*2 + 1000*10) / 1_000_000
  assert.equal(calcolaCostoUsd("claude-sonnet-5", 1000, 1000), 0.012);
  assert.equal(calcolaCostoUsd("claude-sonnet-5", 0, 0), 0);
  assert.equal(calcolaCostoUsd("claude-sonnet-5", null, null), 0);
  assert.equal(calcolaCostoUsd("un-modello-mai-sentito", 1000, 1000), null, "un modello non in listino non deve produrre un costo inventato");
});

test("Cost control AI: registrazione, dashboard super-admin, mai un costo per usage assente", async (t) => {
  const suffix = `aicost_${Date.now()}`;
  const tenant = await prisma.tenant.create({ data: { ragioneSociale: `AI Cost Test ${suffix}`, piano: "PRO" } });
  const created = [];

  try {
    await t.test("registraCostoAi non scrive nulla se usage è assente (risposta di errore)", async () => {
      await registraCostoAi({ tenantId: tenant.id, funzione: "ASSISTENTE", model: "claude-sonnet-5", usage: undefined });
      const righe = await prisma.aiCostLog.findMany({ where: { tenantId: tenant.id } });
      assert.equal(righe.length, 0);
    });

    await t.test("registraCostoAi non scrive nulla per un modello fuori listino", async () => {
      await registraCostoAi({ tenantId: tenant.id, funzione: "ASSISTENTE", model: "modello-sconosciuto", usage: { input_tokens: 100, output_tokens: 50 } });
      const righe = await prisma.aiCostLog.findMany({ where: { tenantId: tenant.id } });
      assert.equal(righe.length, 0);
    });

    await t.test("registraCostoAi salva tenant/funzione/provider/model/token/costo/timestamp", async () => {
      await registraCostoAi({ tenantId: tenant.id, funzione: "COPILOT", model: "claude-sonnet-5", usage: { input_tokens: 2000, output_tokens: 500 } });
      const riga = await prisma.aiCostLog.findFirst({ where: { tenantId: tenant.id } });
      created.push(riga.id);
      assert.equal(riga.funzione, "COPILOT");
      assert.equal(riga.provider, "anthropic");
      assert.equal(riga.model, "claude-sonnet-5");
      assert.equal(riga.tokenInput, 2000);
      assert.equal(riga.tokenOutput, 500);
      assert.equal(Number(riga.costoStimatoUsd), calcolaCostoUsd("claude-sonnet-5", 2000, 500));
      assert.ok(riga.createdAt instanceof Date);
    });

    await t.test("una seconda voce di funzione diversa per lo stesso tenant", async () => {
      await registraCostoAi({ tenantId: tenant.id, funzione: "DAMAGE_ASSISTANT", model: "claude-sonnet-5", usage: { input_tokens: 5000, output_tokens: 800 } });
      const righe = await prisma.aiCostLog.findMany({ where: { tenantId: tenant.id } });
      created.push(...righe.map((r) => r.id).filter((id) => !created.includes(id)));
      assert.equal(righe.length, 2);
    });

    await t.test("dashboardCostoAi: costo oggi e mese includono il tenant, per funzione e per piano corretti", async () => {
      const dash = await dashboardCostoAi();
      const rigaTenant = dash.perTenant.find((r) => r.tenantId === tenant.id);
      assert.ok(rigaTenant, "il tenant deve comparire in perTenant");
      assert.equal(rigaTenant.richieste, 2);

      const rigaCopilot = dash.perFunzione.find((r) => r.funzione === "COPILOT");
      assert.ok(rigaCopilot);
      const rigaDamage = dash.perFunzione.find((r) => r.funzione === "DAMAGE_ASSISTANT");
      assert.ok(rigaDamage);

      const rigaPiano = dash.perPiano.find((r) => r.piano === "PRO");
      assert.ok(rigaPiano);
      assert.ok(rigaPiano.costoUsd >= rigaTenant.costoUsd);

      assert.ok(dash.costoOggiUsd >= rigaTenant.costoUsd);
      assert.ok(dash.costoMeseUsd >= rigaTenant.costoUsd);
    });

    await t.test("GET /api/super-admin/ai-cost: 401 senza token, 200 con token e dati coerenti", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/super-admin", superAdminRouter);
      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        assert.equal((await fetch(`${base}/api/super-admin/ai-cost`)).status, 401);

        const email = `super.${suffix}@example.invalid`;
        const superPasswordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
        const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash: superPasswordHash } });
        try {
          const login = await fetch(`${base}/api/super-admin/login`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "SuperTestPassword12345!" }),
          });
          const { token } = await login.json();
          const res = await fetch(`${base}/api/super-admin/ai-cost`, { headers: { Authorization: `Bearer ${token}` } });
          assert.equal(res.status, 200);
          const dati = await res.json();
          assert.ok(dati.perTenant.some((r) => r.tenantId === tenant.id));
          assert.ok(typeof dati.costoOggiUsd === "number");
        } finally {
          await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
        }
      } finally {
        server.close();
      }
    });
  } finally {
    await prisma.aiCostLog.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});
