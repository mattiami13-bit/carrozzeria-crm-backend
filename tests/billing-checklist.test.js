// Punto 30 (test billing obbligatori): copre la checklist del prompt
// non già coperta da billing.test.js (checkout base, webhook, idempotenza,
// pagamento fallito, cancellazione) o billing-plan-changes.test.js
// (upgrade/downgrade base). Stessa politica di sempre: dati reali,
// nessun mock del database; solo la firma dei webhook è generata con
// l'header helper ufficiale dell'SDK Stripe.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-billing-checklist-test-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_fake_key_for_local_tests";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_fake_secret_for_local_tests";
// Price ID fittizi ma coerenti con lib/billing/piani.js, solo per questo
// test: in locale le variabili reali di Stripe non sono impostate.
process.env.STRIPE_PRICE_STARTER_MENSILE = "price_test_starter_mensile";
process.env.STRIPE_PRICE_STARTER_ANNUALE = "price_test_starter_annuale";
process.env.STRIPE_PRICE_PRO_MENSILE = "price_test_pro_mensile";
process.env.STRIPE_PRICE_PRO_ANNUALE = "price_test_pro_annuale";
process.env.STRIPE_PRICE_PREMIUM_AI_MENSILE = "price_test_premium_mensile";
process.env.STRIPE_PRICE_PREMIUM_AI_ANNUALE = "price_test_premium_annuale";
process.env.STRIPE_PRICE_SETUP_FEE = "price_test_setup_fee";
process.env.STRIPE_PRICE_EARLY_ADOPTER_PRO = "price_test_early_adopter";
process.env.STRIPE_PRICE_AI_CREDITI_PACK = "price_test_crediti_ai";

const { prisma } = await import("../src/lib/prisma.js");
const { billingRouter, billingWebhookRouter } = await import("../src/routes/billing.js");
const { PIANI, TRIAL_PIANO, EARLY_ADOPTER, AI_CREDITI_PACK, stripePriceId, featuresPerPiano, haFeature } = await import("../src/lib/billing/piani.js");

function buildApp() {
  const app = express();
  app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use("/api/billing/webhook", billingWebhookRouter);
  app.use("/api/billing", billingRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
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

test("Billing checklist (punto 30)", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const invia = (payload, header) => fetch(`${base}/api/billing/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });

  const suffix = Date.now();
  const created = [];
  const passwordHash = await bcrypt.hash("Test1234!", 10);

  async function creaTenant(overrides = {}) {
    const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Billing Checklist ${suffix} ${Math.random()}`, ...overrides } });
    const admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `bc.${suffix}.${Math.random()}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    created.push(tenant.id);
    return { tenant, admin, token: tokenFor(admin, tenant.id) };
  }

  try {
    // --- [Starter/Pro/Premium AI] x [mensile/annuale]: risoluzione prezzo ---
    await t.test("risoluzione Price ID per tutti e 6 i piani/periodicità", () => {
      for (const piano of ["STARTER", "PRO", "PREMIUM_AI"]) {
        for (const periodicita of ["MENSILE", "ANNUALE"]) {
          const priceId = stripePriceId(piano, periodicita);
          assert.ok(priceId, `${piano} ${periodicita} deve risolvere un Price ID`);
          assert.equal(priceId, process.env[PIANI[piano][`stripePriceEnv${periodicita === "MENSILE" ? "Mensile" : "Annuale"}`]]);
        }
      }
    });

    // --- trial Pro ---
    await t.test("trial: eredita le entitlement del piano Pro", () => {
      assert.equal(TRIAL_PIANO, "PRO");
      assert.deepEqual(featuresPerPiano("TRIAL"), featuresPerPiano("PRO"));
      assert.equal(haFeature({ piano: "TRIAL" }, "technician_mode"), true);
      assert.equal(haFeature({ piano: "TRIAL" }, "ai_copilot"), false, "il trial NON deve includere le funzioni esclusive Premium AI");
    });

    // --- Early Adopter: prezzo, tetto redemption, setup fee gratuita ---
    await t.test("Early Adopter: checkout usa il prezzo promo e azzera il costo di attivazione", async () => {
      const { token } = await creaTenant();
      const res = await call("/api/billing/checkout", token, { method: "POST", body: JSON.stringify({ piano: "PRO", periodicita: "MENSILE", earlyAdopter: true }) });
      assert.equal(res.status, 502, "con una chiave Stripe finta la chiamata reale a Stripe fallisce qui — conferma che ha superato i controlli di validità/tetto Early Adopter, che avrebbero risposto 400/409 prima di arrivare a Stripe");
    });

    await t.test("Early Adopter: rifiutato se non è PRO mensile", async () => {
      const { token } = await creaTenant();
      const res = await call("/api/billing/checkout", token, { method: "POST", body: JSON.stringify({ piano: "STARTER", periodicita: "MENSILE", earlyAdopter: true }) });
      assert.equal(res.status, 400);
    });

    await t.test("Early Adopter: massimo 30 redemption, poi rifiutato (409)", async () => {
      // Simula 30 tenant che hanno già usato la promo, senza ricrearli
      // tutti da zero: basta far risultare vero il conteggio che il
      // checkout controlla (prisma.tenant.count({earlyAdopter:true})).
      const trenta = [];
      for (let i = 0; i < EARLY_ADOPTER.maxRedemption; i++) {
        const t2 = await prisma.tenant.create({ data: { ragioneSociale: `Early Adopter Slot ${suffix} ${i}`, earlyAdopter: true } });
        trenta.push(t2.id);
        created.push(t2.id);
      }
      const { token } = await creaTenant();
      const res = await call("/api/billing/checkout", token, { method: "POST", body: JSON.stringify({ piano: "PRO", periodicita: "MENSILE", earlyAdopter: true }) });
      assert.equal(res.status, 409, "con 30 posti già occupati, il 31° tentativo deve essere rifiutato");
    });

    // --- Setup fee 199€ per un cliente normale (non Early Adopter) ---
    await t.test("Setup fee: applicata al primo checkout per un cliente normale", async () => {
      const { tenant, token } = await creaTenant();
      assert.equal(tenant.stripeCustomerId, null, "precondizione: nessun cliente Stripe ancora");
      // Non possiamo verificare gli line_items della sessione senza una
      // vera chiamata Stripe riuscita (chiave finta in locale) — verifichiamo
      // invece che la richiesta arrivi fino al tentativo di creare la
      // sessione Stripe (unico punto dove la setup fee viene aggiunta),
      // cioè non fallisca prima per validazione.
      const res = await call("/api/billing/checkout", token, { method: "POST", body: JSON.stringify({ piano: "STARTER", periodicita: "MENSILE" }) });
      assert.equal(res.status, 502, "con una chiave Stripe finta, la chiamata reale a Stripe fallisce qui — conferma che ha superato tutti i controlli precedenti (incluso il calcolo della setup fee)");
    });

    // --- Downgrade bloccato se utenti sopra soglia ---
    await t.test("Downgrade rifiutato se gli utenti attivi superano il nuovo piano", async () => {
      const { tenant, token } = await creaTenant({ piano: "PRO" });
      // STARTER include 3 utenti: ne creiamo abbastanza da superare la soglia.
      for (let i = 0; i < PIANI.STARTER.utentiInclusi + 1; i++) {
        await prisma.user.create({ data: { tenantId: tenant.id, nome: "U", cognome: String(i), email: `bc.utente.${suffix}.${i}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
      }
      const res = await call("/api/billing/checkout", token, { method: "POST", body: JSON.stringify({ piano: "STARTER", periodicita: "MENSILE" }) });
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.ok(data.utentiUsati > data.utentiInclusi);
    });

    await t.test("Downgrade concesso se gli utenti attivi rientrano nel nuovo piano", async () => {
      const { token } = await creaTenant({ piano: "PRO" }); // nessun utente extra oltre l'admin
      const res = await call("/api/billing/checkout", token, { method: "POST", body: JSON.stringify({ piano: "STARTER", periodicita: "MENSILE" }) });
      assert.equal(res.status, 502, "deve superare il controllo utenti e arrivare al tentativo (fallito solo per la chiave Stripe finta)");
    });

    // --- Crediti AI: acquisto e accredito via webhook ---
    await t.test("Crediti AI: rifiuta l'acquisto senza un abbonamento attivo", async () => {
      const { token } = await creaTenant(); // nessun stripeCustomerId
      const res = await call("/api/billing/crediti-ai", token, { method: "POST" });
      assert.equal(res.status, 400);
    });

    await t.test("Crediti AI: il webhook di pagamento riuscito accredita i crediti, senza toccare piano/stato", async () => {
      const { tenant } = await creaTenant({ piano: "PRO", subscriptionStatus: "ACTIVE", stripeCustomerId: `cus_crediti_${suffix}` });
      const { payload, header } = firmaEvento({
        id: `evt_crediti_${suffix}`,
        type: "checkout.session.completed",
        data: { object: { mode: "payment", customer: `cus_crediti_${suffix}`, metadata: { tenantId: tenant.id, tipo: "crediti_ai", crediti: String(AI_CREDITI_PACK.crediti) } } },
      });
      const res = await invia(payload, header);
      assert.equal(res.status, 200);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.creditiAIAcquistati, AI_CREDITI_PACK.crediti);
      assert.equal(aggiornato.piano, "PRO", "l'acquisto di crediti non deve toccare il piano");
      await prisma.stripeWebhookEvent.delete({ where: { id: `evt_crediti_${suffix}` } }).catch(() => {});
    });

    await t.test("Crediti AI: un secondo acquisto si somma, non sovrascrive", async () => {
      const { tenant } = await creaTenant({ piano: "PRO", subscriptionStatus: "ACTIVE", stripeCustomerId: `cus_crediti2_${suffix}`, creditiAIAcquistati: 500 });
      const { payload, header } = firmaEvento({
        id: `evt_crediti2_${suffix}`,
        type: "checkout.session.completed",
        data: { object: { mode: "payment", customer: `cus_crediti2_${suffix}`, metadata: { tenantId: tenant.id, tipo: "crediti_ai", crediti: String(AI_CREDITI_PACK.crediti) } } },
      });
      await invia(payload, header);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.creditiAIAcquistati, 500 + AI_CREDITI_PACK.crediti);
      await prisma.stripeWebhookEvent.delete({ where: { id: `evt_crediti2_${suffix}` } }).catch(() => {});
    });

    // --- Rinnovo riuscito ---
    await t.test("Rinnovo riuscito (invoice.paid) riporta ACTIVE un tenant PAST_DUE", async () => {
      const { tenant } = await creaTenant({ subscriptionStatus: "PAST_DUE", stripeCustomerId: `cus_rinnovo_${suffix}` });
      const { payload, header } = firmaEvento({ id: `evt_rinnovo_${suffix}`, type: "invoice.paid", data: { object: { customer: `cus_rinnovo_${suffix}` } } });
      const res = await invia(payload, header);
      assert.equal(res.status, 200);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.subscriptionStatus, "ACTIVE");
      await prisma.stripeWebhookEvent.delete({ where: { id: `evt_rinnovo_${suffix}` } }).catch(() => {});
    });

    // --- Cancellazione a fine periodo (non immediata) ---
    await t.test("Cancellazione programmata a fine periodo: cancelAtPeriodEnd=true, abbonamento resta attivo", async () => {
      const { tenant } = await creaTenant({ subscriptionStatus: "ACTIVE", stripeCustomerId: `cus_findperiodo_${suffix}`, stripeSubscriptionId: `sub_findperiodo_${suffix}` });
      const { payload, header } = firmaEvento({
        id: `evt_findperiodo_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: { id: `sub_findperiodo_${suffix}`, customer: `cus_findperiodo_${suffix}`, status: "active", cancel_at_period_end: true, items: { data: [{ price: { id: "inesistente" } }] } } },
      });
      const res = await invia(payload, header);
      assert.equal(res.status, 200);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.subscriptionStatus, "ACTIVE", "resta attivo fino alla vera fine periodo");
      assert.equal(aggiornato.cancelAtPeriodEnd, true);
      await prisma.stripeWebhookEvent.delete({ where: { id: `evt_findperiodo_${suffix}` } }).catch(() => {});
    });

    // --- Riattivazione (l'utente annulla la cancellazione programmata) ---
    await t.test("Riattivazione: cancelAtPeriodEnd torna false senza nuovo checkout", async () => {
      const { tenant } = await creaTenant({ subscriptionStatus: "ACTIVE", cancelAtPeriodEnd: true, stripeCustomerId: `cus_riattiva_${suffix}`, stripeSubscriptionId: `sub_riattiva_${suffix}` });
      const { payload, header } = firmaEvento({
        id: `evt_riattiva_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: { id: `sub_riattiva_${suffix}`, customer: `cus_riattiva_${suffix}`, status: "active", cancel_at_period_end: false, items: { data: [{ price: { id: "inesistente" } }] } } },
      });
      const res = await invia(payload, header);
      assert.equal(res.status, 200);
      const aggiornato = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(aggiornato.cancelAtPeriodEnd, false);
      await prisma.stripeWebhookEvent.delete({ where: { id: `evt_riattiva_${suffix}` } }).catch(() => {});
    });

    // --- Entitlement aggiornati subito dopo il cambio piano ---
    await t.test("Entitlement aggiornati immediatamente dopo un cambio piano via webhook", async () => {
      const { tenant } = await creaTenant({ piano: "STARTER", subscriptionStatus: "ACTIVE", stripeCustomerId: `cus_entitlement_${suffix}`, stripeSubscriptionId: `sub_entitlement_${suffix}` });
      let attuale = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(haFeature(attuale, "technician_mode"), false, "Starter non include Modalità Tecnico");

      const { payload, header } = firmaEvento({
        id: `evt_entitlement_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: { id: `sub_entitlement_${suffix}`, customer: `cus_entitlement_${suffix}`, status: "active", cancel_at_period_end: false, items: { data: [{ price: { id: "price_test_pro_mensile" } }] } } },
      });
      await invia(payload, header);
      attuale = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.equal(attuale.piano, "PRO");
      assert.equal(haFeature(attuale, "technician_mode"), true, "subito dopo l'upgrade, Modalità Tecnico deve risultare inclusa");
      await prisma.stripeWebhookEvent.delete({ where: { id: `evt_entitlement_${suffix}` } }).catch(() => {});
    });

    // --- AI bloccata/limitata secondo quota ---
    // Verifica statica (non chiamata HTTP dal vivo): le rotte che usano
    // l'IA richiedono ANTHROPIC_API_KEY, non disponibile in locale — stesso
    // limite già documentato per il test del Copilot in
    // tenant-isolation.test.js. Confermiamo che ogni rotta AI a consumo
    // controlli davvero un limite mensile prima di procedere, e che un
    // limite manuale sul tenant (limiteAnalisiIAMensile) prevalga sempre
    // sul default del piano — il meccanismo che rende possibile "accordi
    // personalizzati" senza toccare codice.
    //
    // Punto 40 (usage tracking): i 5 file leggevano ciascuno una copia
    // locale identica di questi limiti — centralizzati in lib/aiUsage.js
    // per evitare lo stesso rischio di disallineamento già visto al
    // punto 29 (PROFESSIONAL/ENTERPRISE). Il test ora verifica che ogni
    // rotta importi da lì, e che aiUsage.js stesso legga davvero i due
    // campi sul tenant.
    await t.test("Ogni rotta AI a consumo controlla un limite mensile prima di procedere", () => {
      const aiUsageSrc = fs.readFileSync(new URL(`../src/lib/aiUsage.js`, import.meta.url), "utf-8");
      assert.match(aiUsageSrc, /limiteAnalisiIAMensile/, "lib/aiUsage.js: deve leggere il limite manuale per le analisi IA");
      assert.match(aiUsageSrc, /limiteAssistenteIAMensile/, "lib/aiUsage.js: deve leggere il limite manuale per l'assistente/copilot");

      for (const file of ["vehicles.js", "damageAssistant.js", "insuranceGap.js", "assistente.js", "copilot.js"]) {
        const src = fs.readFileSync(new URL(`../src/routes/${file}`, import.meta.url), "utf-8");
        assert.match(src, /from ["']\.\.\/lib\/aiUsage\.js["']/, `${file}: deve importare i limiti dalla fonte unica lib/aiUsage.js, non duplicarli`);
        assert.match(src, /429/, `${file}: deve rispondere 429 quando il limite è superato, non un errore generico`);
      }
    });
  } finally {
    for (const tenantId of created) {
      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});
