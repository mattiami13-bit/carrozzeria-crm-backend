// Punto 29 (test automatici, "upgrade"/"downgrade"): customer.subscription.updated
// è l'evento Stripe che arriva sia per un upgrade sia per un downgrade
// (cambio prezzo su un abbonamento esistente) — gestisciSubscriptionAggiornata
// non aveva ancora un test dedicato. La matrice completa piani/periodicità
// è compito del punto 30; qui si verifica solo che il meccanismo funzioni
// davvero in entrambe le direzioni.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-billing-plan-test-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_fake_key_for_local_tests";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_fake_secret_for_local_tests";
// Price ID fittizi ma coerenti con la mappa reale in lib/billing/piani.js,
// solo per questo test: permette a pianoDaPriceId() di risolvere un piano
// vero anche in locale, dove le variabili reali di Stripe non sono impostate.
process.env.STRIPE_PRICE_STARTER_MENSILE = "price_test_starter_mensile";
process.env.STRIPE_PRICE_PRO_MENSILE = "price_test_pro_mensile";

const { prisma } = await import("../src/lib/prisma.js");
const { billingWebhookRouter } = await import("../src/routes/billing.js");

function buildApp() {
  const app = express();
  app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
  app.use("/api/billing/webhook", billingWebhookRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

function firmaEvento(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return { payload, header };
}

test("Billing: upgrade e downgrade cambiano davvero il piano del tenant", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  let tenant;

  const invia = (payload, header) => fetch(`${base}/api/billing/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });

  try {
    tenant = await prisma.tenant.create({
      data: { ragioneSociale: `Billing Plan Change ${suffix}`, piano: "STARTER", subscriptionStatus: "ACTIVE", stripeCustomerId: `cus_planchange_${suffix}`, stripeSubscriptionId: `sub_planchange_${suffix}` },
    });

    await t.test("upgrade: Starter -> Pro", async () => {
      const { payload, header } = firmaEvento({
        id: `evt_upgrade_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: { id: `sub_planchange_${suffix}`, customer: `cus_planchange_${suffix}`, status: "active", cancel_at_period_end: false, items: { data: [{ price: { id: "price_test_pro_mensile" } }] } } },
      });
      const res = await invia(payload, header);
      assert.equal(res.status, 200);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.piano, "PRO");
      assert.equal(aggiornato.fatturazionePeriodicita, "MENSILE");
    });

    await t.test("downgrade: Pro -> Starter", async () => {
      const { payload, header } = firmaEvento({
        id: `evt_downgrade_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: { id: `sub_planchange_${suffix}`, customer: `cus_planchange_${suffix}`, status: "active", cancel_at_period_end: false, items: { data: [{ price: { id: "price_test_starter_mensile" } }] } } },
      });
      const res = await invia(payload, header);
      assert.equal(res.status, 200);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.piano, "STARTER", "il downgrade deve essere applicato: oggi nessun blocco per soglia utenti è ancora implementato (previsto al punto 30)");
    });
  } finally {
    if (tenant) await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    await prisma.stripeWebhookEvent.deleteMany({ where: { id: { in: [`evt_upgrade_${suffix}`, `evt_downgrade_${suffix}`] } } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});
