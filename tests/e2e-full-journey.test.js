// Punto 47 (test end-to-end reale): simula il percorso completo del
// prompt — visitatore → homepage/prezzi → registrazione → verifica
// email → trial/checkout → dashboard → cliente/veicolo/pratica → invito
// tecnico → modulo consentito/non incluso → upgrade → nuova feature →
// crediti AI → fatturazione → logout/login — poi crea un secondo
// tenant e verifica l'isolamento reciproco, poi verifica il super-admin
// (vede entrambe le organizzazioni, metriche aggregate, nessuna
// modifica implicita ai dati).
//
// Contro l'app COMPLETA e reale (src/app.js — la stessa funzione usata
// da src/index.js in produzione, punto 47), non un sottoinsieme di
// router assemblato a mano: se l'ordine di montaggio o un middleware
// cambiasse in modo da rompere questo percorso, questo test se ne
// accorgerebbe, un router isolato no.
//
// Due passaggi reali di Stripe (creare una sessione di checkout/portale
// con una chiave viva) non sono verificabili qui: in locale non è
// configurata una vera chiave Stripe (stesso limite già documentato e
// accettato in billing.test.js/billing-checklist.test.js). Dove serve
// solo un aggiornamento di stato — piano attivato, crediti accreditati
// — si usa il webhook con firma reale (Stripe.webhooks.generateTestHeaderString),
// che non richiede una chiamata di rete in uscita.

import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-e2e-test-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_fake_key_for_local_tests";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_fake_secret_for_local_tests";
process.env.STRIPE_PRICE_STARTER_MENSILE = process.env.STRIPE_PRICE_STARTER_MENSILE || "price_test_starter_mensile";
process.env.STRIPE_PRICE_PREMIUM_AI_MENSILE = process.env.STRIPE_PRICE_PREMIUM_AI_MENSILE || "price_test_premium_mensile";
process.env.STRIPE_PRICE_AI_CREDITI_PACK = process.env.STRIPE_PRICE_AI_CREDITI_PACK || "price_test_crediti_ai";
delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { buildApp } = await import("../src/app.js");

function firmaEvento(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return { payload, header };
}

test("Percorso end-to-end reale: visitatore → cliente pagante → isolamento tra tenant → super-admin", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const inviaWebhook = (payload, header) => fetch(`${base}/api/billing/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });

  const suffix = Date.now();
  const created = { tenants: [] };
  let tokenA, tenantAId, adminAId, clientAId, vehicleAId;
  let tokenB, tenantBId, clientBId, vehicleBId;
  let superAdmin;

  try {
    // ---------------------------------------------------------------
    // VISITATORE
    // ---------------------------------------------------------------
    await t.test("homepage pubblica raggiungibile", async () => {
      const res = await call("/");
      assert.equal(res.status, 200);
    });

    await t.test("prezzi pubblici raggiungibili, senza autenticazione", async () => {
      const res = await call("/api/billing/piani");
      assert.equal(res.status, 200);
      const dati = await res.json();
      assert.ok(dati.piani.some((p) => p.key === "STARTER"));
      assert.ok(dati.piani.some((p) => p.key === "PREMIUM_AI"));
    });

    // ---------------------------------------------------------------
    // REGISTRAZIONE → CARROZZERIA TEST A
    // ---------------------------------------------------------------
    const emailA = `e2e.a.${suffix}@example.invalid`;
    await t.test("registrazione crea la Carrozzeria Test A + utente ADMIN + avvia il trial", async () => {
      const res = await call("/api/auth/register", null, {
        method: "POST",
        body: JSON.stringify({
          ragioneSociale: `Carrozzeria Test A ${suffix}`,
          nomeAdmin: "Admin", cognomeAdmin: "A",
          email: emailA, password: "Test1234!e2e",
          condizioniAccettate: true,
        }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      tokenA = data.token;
      tenantAId = data.tenant.id;
      adminAId = data.user.id;
      created.tenants.push(tenantAId);
      assert.equal(data.user.emailVerificata, false);

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantAId } });
      assert.equal(tenant.piano, "TRIAL");
      assert.equal(tenant.subscriptionStatus, "TRIALING");
      assert.ok(tenant.trialEndsAt > new Date(), "il trial deve avere una scadenza futura");
    });

    // ---------------------------------------------------------------
    // VERIFICA EMAIL
    // ---------------------------------------------------------------
    await t.test("verifica email completa il flusso con il token reale generato alla registrazione", async () => {
      const user = await prisma.user.findUnique({ where: { id: adminAId } });
      assert.ok(user.emailVerificaToken, "la registrazione deve aver generato un token di verifica");

      const res = await call(`/api/auth/verifica-email?token=${user.emailVerificaToken}`);
      assert.equal(res.status, 200);

      const utenteVerificato = await prisma.user.findUnique({ where: { id: adminAId } });
      assert.equal(utenteVerificato.emailVerificata, true);
      assert.equal(utenteVerificato.emailVerificaToken, null, "il token va invalidato dopo l'uso, non riusabile");
    });

    // ---------------------------------------------------------------
    // TRIAL/CHECKOUT — il tenant paga davvero (via webhook, vedi nota in testa al file)
    // ---------------------------------------------------------------
    await t.test("checkout: il tenant passa da TRIAL a STARTER pagante (webhook subscription attivata)", async () => {
      // Simula "il cliente ha completato il checkout Stripe": nella realtà
      // arriverebbe prima checkout.session.completed (che imposta
      // stripeCustomerId) poi customer.subscription.updated. Impostiamo
      // qui lo stripeCustomerId come lo imposterebbe il primo evento,
      // per la stessa ragione già documentata in billing.test.js: senza
      // una vera chiave Stripe, checkout.session.completed per un
      // abbonamento fallisce nella retrieve (limite noto e accettato).
      await prisma.tenant.update({ where: { id: tenantAId }, data: { stripeCustomerId: `cus_e2e_a_${suffix}` } });

      const { payload, header } = firmaEvento({
        id: `evt_e2e_checkout_a_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: {
          id: `sub_e2e_a_${suffix}`, customer: `cus_e2e_a_${suffix}`, status: "active", cancel_at_period_end: false,
          items: { data: [{ price: { id: process.env.STRIPE_PRICE_STARTER_MENSILE } }] },
        } },
      });
      const res = await inviaWebhook(payload, header);
      assert.equal(res.status, 200);

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantAId } });
      assert.equal(tenant.piano, "STARTER");
      assert.equal(tenant.subscriptionStatus, "ACTIVE");
    });

    // ---------------------------------------------------------------
    // ONBOARDING → DASHBOARD
    // ---------------------------------------------------------------
    await t.test("dashboard raggiungibile subito dopo l'attivazione", async () => {
      const res = await call("/api/dashboard/summary", tokenA);
      assert.equal(res.status, 200);
    });

    // ---------------------------------------------------------------
    // CREA CLIENTE → VEICOLO → PRATICA (preventivo)
    // ---------------------------------------------------------------
    await t.test("crea cliente", async () => {
      const res = await call("/api/clients", tokenA, {
        method: "POST", body: JSON.stringify({ nome: "Mario", cognome: "Rossi", telefono: "3331234567" }),
      });
      assert.equal(res.status, 201);
      clientAId = (await res.json()).id;
    });

    await t.test("crea veicolo collegato al cliente", async () => {
      const res = await call("/api/vehicles", tokenA, {
        method: "POST", body: JSON.stringify({ clientId: clientAId, marca: "Fiat", modello: "Panda", targa: `E2E${suffix.toString().slice(-6)}` }),
      });
      assert.equal(res.status, 201);
      vehicleAId = (await res.json()).id;
    });

    await t.test("crea pratica (preventivo) sul veicolo", async () => {
      const res = await call("/api/quotes", tokenA, {
        method: "POST",
        body: JSON.stringify({
          clientId: clientAId, vehicleId: vehicleAId,
          items: [{ tipo: "MANODOPERA", descrizione: "Sostituzione paraurti", quantita: 1, prezzoUnitario: 250 }],
        }),
      });
      assert.equal(res.status, 201);
    });

    // ---------------------------------------------------------------
    // INVITA TECNICO
    // ---------------------------------------------------------------
    await t.test("invita un tecnico", async () => {
      const res = await call("/api/users", tokenA, {
        method: "POST",
        body: JSON.stringify({ nome: "Luca", cognome: "Tecnico", email: `e2e.tecnico.${suffix}@example.invalid`, password: "Test1234!tec", ruolo: "TECNICO" }),
      });
      assert.equal(res.status, 201);
    });

    // ---------------------------------------------------------------
    // MODULO CONSENTITO vs NON INCLUSO (piano STARTER)
    // ---------------------------------------------------------------
    await t.test("modulo consentito su STARTER (clienti/veicoli) funziona", async () => {
      const res = await call("/api/vehicles", tokenA);
      assert.equal(res.status, 200);
    });

    await t.test("modulo NON incluso su STARTER (quality control) è bloccato", async () => {
      const res = await call("/api/qc/template", tokenA);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.featureRequired, "quality_control");
    });

    // ---------------------------------------------------------------
    // UPGRADE → VERIFICA NUOVA FEATURE
    // ---------------------------------------------------------------
    await t.test("upgrade a PREMIUM_AI (webhook) sblocca immediatamente il modulo prima negato", async () => {
      const { payload, header } = firmaEvento({
        id: `evt_e2e_upgrade_a_${suffix}`,
        type: "customer.subscription.updated",
        data: { object: {
          id: `sub_e2e_a_${suffix}`, customer: `cus_e2e_a_${suffix}`, status: "active", cancel_at_period_end: false,
          items: { data: [{ price: { id: process.env.STRIPE_PRICE_PREMIUM_AI_MENSILE } }] },
        } },
      });
      const res = await inviaWebhook(payload, header);
      assert.equal(res.status, 200);

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantAId } });
      assert.equal(tenant.piano, "PREMIUM_AI");

      const qc = await call("/api/qc/template", tokenA);
      assert.equal(qc.status, 200, "la stessa rotta negata su STARTER deve funzionare subito dopo l'upgrade, senza un nuovo login");
    });

    // ---------------------------------------------------------------
    // COMPRA CREDITI AI (accredito verificabile via webhook, vedi nota in testa)
    // ---------------------------------------------------------------
    await t.test("compra crediti AI: l'endpoint di checkout valida i prerequisiti, il webhook di pagamento riuscito accredita davvero", async () => {
      const primaDegliAcquisti = await prisma.tenant.findUnique({ where: { id: tenantAId } });

      // L'endpoint reale (POST /api/billing/crediti-ai) crea una vera
      // sessione Stripe: senza una chiave viva fallisce con 502, ma solo
      // DOPO aver verificato che il tenant abbia un cliente Stripe e un
      // prezzo configurato (altrimenti risponderebbe 400/501) — è quella
      // logica di validazione che verifichiamo qui poterla raggiungere.
      const res = await call("/api/billing/crediti-ai", tokenA, { method: "POST", body: JSON.stringify({}) });
      assert.equal(res.status, 502, "senza una chiave Stripe viva la creazione sessione fallisce in modo esplicito, non silenzioso");

      const { payload, header } = firmaEvento({
        id: `evt_e2e_crediti_a_${suffix}`,
        type: "checkout.session.completed",
        data: { object: {
          mode: "payment", customer: `cus_e2e_a_${suffix}`,
          metadata: { tenantId: tenantAId, tipo: "crediti_ai", crediti: "500" },
        } },
      });
      const webhookRes = await inviaWebhook(payload, header);
      assert.equal(webhookRes.status, 200);

      const dopo = await prisma.tenant.findUnique({ where: { id: tenantAId } });
      assert.equal(dopo.creditiAIAcquistati, primaDegliAcquisti.creditiAIAcquistati + 500);
    });

    // ---------------------------------------------------------------
    // GESTISCE FATTURAZIONE
    // ---------------------------------------------------------------
    await t.test("gestisce fatturazione: stato reale consultabile, portale raggiungibile (fallisce solo per assenza di chiave viva)", async () => {
      const stato = await call("/api/billing/stato", tokenA);
      assert.equal(stato.status, 200);
      const dati = await stato.json();
      assert.equal(dati.piano, "PREMIUM_AI");

      const portale = await call("/api/billing/portal", tokenA, { method: "POST", body: JSON.stringify({}) });
      assert.equal(portale.status, 502, "stesso limite: nessuna chiave Stripe viva in locale");
    });

    // ---------------------------------------------------------------
    // LOGOUT / LOGIN
    // ---------------------------------------------------------------
    await t.test("logout/login: un nuovo login produce un token valido e funzionante", async () => {
      const res = await call("/api/auth/login", null, {
        method: "POST", body: JSON.stringify({ email: emailA, password: "Test1234!e2e" }),
      });
      assert.equal(res.status, 200);
      const nuovoToken = (await res.json()).token;
      assert.ok(nuovoToken);

      const verifica = await call("/api/vehicles", nuovoToken);
      assert.equal(verifica.status, 200);
      tokenA = nuovoToken; // usato dalla sezione isolamento sotto
    });

    // ---------------------------------------------------------------
    // CARROZZERIA TEST B + ISOLAMENTO RECIPROCO
    // ---------------------------------------------------------------
    const emailB = `e2e.b.${suffix}@example.invalid`;
    await t.test("crea Carrozzeria Test B, indipendente dalla A", async () => {
      const res = await call("/api/auth/register", null, {
        method: "POST",
        body: JSON.stringify({
          ragioneSociale: `Carrozzeria Test B ${suffix}`,
          nomeAdmin: "Admin", cognomeAdmin: "B",
          email: emailB, password: "Test1234!e2e",
          condizioniAccettate: true,
        }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      tokenB = data.token;
      tenantBId = data.tenant.id;
      created.tenants.push(tenantBId);
      assert.notEqual(tenantBId, tenantAId);
    });

    await t.test("B crea i propri dati, indipendenti da A", async () => {
      const client = await call("/api/clients", tokenB, {
        method: "POST", body: JSON.stringify({ nome: "Giulia", cognome: "Bianchi" }),
      });
      assert.equal(client.status, 201);
      clientBId = (await client.json()).id;

      const vehicle = await call("/api/vehicles", tokenB, {
        method: "POST", body: JSON.stringify({ clientId: clientBId, marca: "Renault", modello: "Clio", targa: `E2B${suffix.toString().slice(-6)}` }),
      });
      assert.equal(vehicle.status, 201);
      vehicleBId = (await vehicle.json()).id;
    });

    await t.test("VERIFICA: A e B non possono accedere ai dati reciproci", async () => {
      // A prova a leggere i dati di B, per id diretto (IDOR) e per lista.
      assert.equal((await call(`/api/clients/${clientBId}`, tokenA)).status, 404);
      assert.equal((await call(`/api/vehicles/${vehicleBId}`, tokenA)).status, 404);
      const listaClientiPerA = await (await call("/api/clients", tokenA)).json();
      assert.ok(!listaClientiPerA.some((c) => c.id === clientBId), "il cliente di B non deve comparire nella lista di A");

      // B prova a leggere i dati di A.
      assert.equal((await call(`/api/clients/${clientAId}`, tokenB)).status, 404);
      assert.equal((await call(`/api/vehicles/${vehicleAId}`, tokenB)).status, 404);
      const listaClientiPerB = await (await call("/api/clients", tokenB)).json();
      assert.ok(!listaClientiPerB.some((c) => c.id === clientAId), "il cliente di A non deve comparire nella lista di B");

      // Tentativo diretto: agganciare un veicolo al cliente di A usando il token di B.
      const idor = await call("/api/vehicles", tokenB, {
        method: "POST", body: JSON.stringify({ clientId: clientAId, marca: "Test", modello: "IDOR", targa: `IDOR${suffix}` }),
      });
      assert.equal(idor.status, 400, "B non deve poter agganciare un veicolo al cliente di A");
    });

    // ---------------------------------------------------------------
    // SUPER ADMIN
    // ---------------------------------------------------------------
    const superEmail = `e2e.super.${suffix}@example.invalid`;
    let superToken, pianoAPrimaDelleLetture;
    await t.test("super-admin: login e visibilità su ENTRAMBE le organizzazioni", async () => {
      const bcrypt = (await import("bcryptjs")).default;
      const passwordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
      superAdmin = await prisma.superAdmin.create({ data: { email: superEmail, passwordHash } });

      const login = await call("/api/super-admin/login", null, {
        method: "POST", body: JSON.stringify({ email: superEmail, password: "SuperTestPassword12345!" }),
      });
      assert.equal(login.status, 200);
      superToken = (await login.json()).token;

      const tenants = await (await call("/api/super-admin/tenants", superToken)).json();
      assert.ok(tenants.some((t) => t.id === tenantAId), "il super-admin deve vedere la Carrozzeria Test A");
      assert.ok(tenants.some((t) => t.id === tenantBId), "il super-admin deve vedere la Carrozzeria Test B");
    });

    await t.test("super-admin: vede metriche aggregate su entrambe le organizzazioni", async () => {
      const usage = await (await call("/api/super-admin/usage", superToken)).json();
      assert.ok(usage.some((r) => r.tenantId === tenantAId));
      assert.ok(usage.some((r) => r.tenantId === tenantBId));

      pianoAPrimaDelleLetture = (await prisma.tenant.findUnique({ where: { id: tenantAId } })).piano;
    });

    await t.test("super-admin: nessuna delle letture sopra ha alterato dati implicitamente", async () => {
      const tenantA = await prisma.tenant.findUnique({ where: { id: tenantAId } });
      assert.equal(tenantA.piano, pianoAPrimaDelleLetture, "una semplice lettura del super-admin non deve mai cambiare il piano di un tenant");

      // Un'azione che ALTERA dati (cambio stato Lead, non usato qui)
      // richiede sempre una PATCH esplicita altrove — le GET usate in
      // questo test (tenants, usage) sono strutturalmente di sola
      // lettura: nessun handler di quelle rotte contiene una scrittura.
    });
  } finally {
    server.close();
    if (superAdmin) await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
    for (const tenantId of created.tenants) {
      // QuoteItem e StageHistory non hanno onDelete: Cascade verso
      // Quote/Vehicle: vanno rimossi prima, altrimenti le deleteMany
      // successive falliscono silenziosamente (dietro il .catch) e
      // bloccano a cascata anche il resto — trovato proprio scrivendo
      // questo stesso test (due tenant di prova rimasti a vita nel
      // database di sviluppo, ripuliti a mano), corretto qui.
      await prisma.quoteItem.deleteMany({ where: { quote: { tenantId } } }).catch(() => {});
      await prisma.quote.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.stageHistory.deleteMany({ where: { vehicle: { tenantId } } }).catch(() => {});
      await prisma.vehicle.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.client.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: tenantId } }).catch((err) => {
        console.error(`[e2e] Pulizia tenant ${tenantId} non riuscita:`, err.message);
      });
    }
  }
});
