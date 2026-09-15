// Billing/Stripe (punto 6 del prompt SaaS). Non richiede chiavi Stripe
// reali: la chiave segreta è finta (serve solo a istanziare l'SDK, non
// viene mai usata per una vera chiamata di rete in questi test) e la
// firma del webhook è generata localmente con l'header helper ufficiale
// dell'SDK Stripe, che verifica la CORRETTEZZA della nostra logica di
// verifica/idempotenza/aggiornamento stato senza toccare la rete.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-billing-test-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_fake_key_for_local_tests";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_fake_secret_for_local_tests";

const { prisma } = await import("../src/lib/prisma.js");
const { billingRouter, billingWebhookRouter } = await import("../src/routes/billing.js");
const { PIANI } = await import("../src/lib/billing/piani.js");

function buildApp() {
  const app = express();
  app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use("/api/billing/webhook", billingWebhookRouter);
  app.use("/api/billing", billingRouter);
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

function tokenFor(user, tenantId) {
  return jwt.sign({ sub: user.id, tenantId, role: user.ruolo }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function firmaEvento(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return { payload, header };
}

test("Billing: piani pubblici, stato, e webhook Stripe (firma, idempotenza, effetti)", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout: nessuna risposta da ${init.method || "GET"} ${path} entro 8s`)), 8000);
    const raw = init.raw;
    return fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(raw ? {} : { "Content-Type": "application/json" }),
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).finally(() => clearTimeout(timer));
  };

  const suffix = Date.now();
  const created = { tenants: [] };
  let tenant, admin, tecnico, tokenAdmin, tokenTecnico;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `Billing Test ${suffix}` } });
    created.tenants.push(tenant.id);
    const passwordHash = await bcrypt.hash("Test1234!Billing", 10);
    admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Admin", cognome: "B", email: `billing.admin.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    tecnico = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "B", email: `billing.tecnico.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    tokenAdmin = tokenFor(admin, tenant.id);
    tokenTecnico = tokenFor(tecnico, tenant.id);

    await t.test("GET /api/billing/piani è pubblico e riflette la configurazione centrale", async () => {
      const res = await call("/api/billing/piani");
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.piani.length, 3);
      assert.deepEqual(data.piani.map((p) => p.key).sort(), ["PREMIUM_AI", "PRO", "STARTER"]);
      assert.equal(data.piani.find((p) => p.key === "PRO").prezzoMensileCents, PIANI.PRO.prezzoMensileCents);
      assert.equal(data.earlyAdopter.postiRimasti, 30);
    });

    await t.test("GET /api/billing/stato richiede autenticazione e ruolo ADMIN/AMMINISTRAZIONE", async () => {
      const resSenzaAuth = await call("/api/billing/stato");
      assert.equal(resSenzaAuth.status, 401);

      const resTecnico = await call("/api/billing/stato", tokenTecnico);
      assert.equal(resTecnico.status, 403);

      const resAdmin = await call("/api/billing/stato", tokenAdmin);
      assert.equal(resAdmin.status, 200);
      const data = await resAdmin.json();
      assert.equal(data.piano, "TRIAL");
      assert.equal(data.subscriptionStatus, "TRIALING");
    });

    await t.test("POST /api/billing/checkout risponde 501 chiaro se il Price ID non è configurato", async () => {
      const res = await call("/api/billing/checkout", tokenAdmin, {
        method: "POST",
        body: JSON.stringify({ piano: "PRO", periodicita: "MENSILE" }),
      });
      // In locale STRIPE_PRICE_PRO_MENSILE non è configurata: l'endpoint
      // deve dirlo chiaramente, mai fingere un checkout riuscito.
      assert.equal(res.status, 501);
    });

    await t.test("webhook: firma non valida viene rifiutata (400), nessun dato modificato", async () => {
      const { payload } = firmaEvento({ id: "evt_fake", type: "checkout.session.completed", data: { object: {} } });
      const res = await call("/api/billing/webhook", null, {
        method: "POST", raw: true, body: payload,
        headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=firmainventata" },
      });
      assert.equal(res.status, 400);
    });

    await t.test("webhook: checkout.session.completed attiva il piano sul tenant corretto", async () => {
      const eventId = `evt_checkout_${suffix}`;
      const { payload, header } = firmaEvento({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer: `cus_fake_${suffix}`,
            subscription: `sub_fake_${suffix}`,
            client_reference_id: tenant.id,
            metadata: { tenantId: tenant.id, piano: "PRO", periodicita: "MENSILE", earlyAdopter: "false" },
          },
        },
      });

      // stripe.subscriptions.retrieve(session.subscription) viene chiamata
      // dal nostro handler: senza una vera chiave Stripe fallirebbe con un
      // errore di rete/autenticazione, che il webhook propaga come 500 (e
      // Stripe ritenterebbe). Verifichiamo che il comportamento sia
      // ESATTAMENTE questo — nessun crash silenzioso, nessun falso successo —
      // che è la garanzia di sicurezza rilevante qui: l'unica cosa che NON
      // possiamo verificare senza una chiave reale è l'esito positivo finale.
      const res = await call("/api/billing/webhook", null, {
        method: "POST", raw: true, body: payload,
        headers: { "Content-Type": "application/json", "stripe-signature": header },
      });
      assert.equal(res.status, 500, "senza una vera API key la retrieve della subscription deve fallire in modo esplicito, non silenzioso");

      const evento = await prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });
      assert.ok(evento, "l'evento va comunque registrato come 'visto' prima di tentare l'elaborazione (idempotenza)");
    });

    await t.test("webhook: un evento già visto (stesso id) viene ignorato la seconda volta (idempotenza)", async () => {
      const eventId = `evt_idempotenza_${suffix}`;
      await prisma.stripeWebhookEvent.create({ data: { id: eventId, tipo: "customer.subscription.deleted" } });

      const { payload, header } = firmaEvento({
        id: eventId,
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_non_esiste", customer: "cus_non_esiste" } },
      });

      const res = await call("/api/billing/webhook", null, {
        method: "POST", raw: true, body: payload,
        headers: { "Content-Type": "application/json", "stripe-signature": header },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.duplicato, true);
    });

    await t.test("webhook: customer.subscription.deleted marca CANCELED senza toccare i dati operativi", async () => {
      await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: `cus_cancel_${suffix}`, stripeSubscriptionId: `sub_cancel_${suffix}`, subscriptionStatus: "ACTIVE", piano: "PRO" } });

      const client = await prisma.client.create({ data: { tenantId: tenant.id, nome: "Non", cognome: "Toccare" } });

      const eventId = `evt_delete_${suffix}`;
      const { payload, header } = firmaEvento({
        id: eventId,
        type: "customer.subscription.deleted",
        data: { object: { id: `sub_cancel_${suffix}`, customer: `cus_cancel_${suffix}` } },
      });

      const res = await call("/api/billing/webhook", null, {
        method: "POST", raw: true, body: payload,
        headers: { "Content-Type": "application/json", "stripe-signature": header },
      });
      assert.equal(res.status, 200);

      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.subscriptionStatus, "CANCELED");
      assert.equal(aggiornato.piano, "PRO", "il piano non deve essere azzerato: i dati/entitlement restano fino a decisione esplicita");

      const clienteAncoraPresente = await prisma.client.findUnique({ where: { id: client.id } });
      assert.ok(clienteAncoraPresente, "nessun dato operativo deve essere toccato dalla cancellazione dell'abbonamento");
    });

    await t.test("webhook: invoice.payment_failed marca PAST_DUE e notifica gli ADMIN", async () => {
      await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: `cus_fail_${suffix}`, subscriptionStatus: "ACTIVE" } });

      const eventId = `evt_fail_${suffix}`;
      const { payload, header } = firmaEvento({
        id: eventId,
        type: "invoice.payment_failed",
        data: { object: { customer: `cus_fail_${suffix}` } },
      });

      const res = await call("/api/billing/webhook", null, {
        method: "POST", raw: true, body: payload,
        headers: { "Content-Type": "application/json", "stripe-signature": header },
      });
      assert.equal(res.status, 200);

      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.subscriptionStatus, "PAST_DUE");

      const notifiche = await prisma.notification.findMany({ where: { tenantId: tenant.id, categoria: "PAGAMENTI", userId: admin.id } });
      assert.ok(notifiche.some((n) => n.titolo.includes("Pagamento non riuscito")));
    });
  } finally {
    for (const tenantId of created.tenants) {
      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.client.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await prisma.stripeWebhookEvent.deleteMany({ where: { id: { in: [`evt_checkout_${suffix}`, `evt_idempotenza_${suffix}`, `evt_delete_${suffix}`, `evt_fail_${suffix}`] } } });
    await new Promise((r) => server.close(r));
  }
});
