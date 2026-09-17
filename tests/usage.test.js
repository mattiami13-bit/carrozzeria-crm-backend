// Punto 40 (usage tracking): verifica con dati reali che il riepilogo
// per tenant (super-admin) aggreghi correttamente le 6 categorie, e che
// l'alert sul limite AI (lib/aiUsage.js) scatti davvero come notifica
// in-app alla soglia del 90% e del 100%, una sola volta ciascuna.
//
// Il percorso di SCRITTURA di email/API esterne (src/lib/email.js,
// src/lib/notifiche.js, routes/billing.js) non è testato qui: richiede
// un invio Resend/Stripe reale per essere esercitato, e i test non
// devono mai inviare email vere (vedi RESEND_API_KEY disattivata sotto,
// stesso motivo di tutti gli altri file di test che toccano email). È
// una singola riga (prisma.usageEvent.create) per ciascun punto di
// invio: il valore da verificare è l'aggregazione, coperta qui.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { riepilogoUsoTuttiTenant } = await import("../src/lib/usageSummary.js");
const { segnalaUsoAssistente, segnalaUsoAnalisiIA, limiteAssistente, limiteAnalisiIA } = await import("../src/lib/aiUsage.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

test("Usage tracking: il riepilogo super-admin aggrega correttamente tutte le categorie", async (t) => {
  const suffix = `usage_${Date.now()}`;
  const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Usage Test ${suffix}`, piano: "STARTER" } });
  const passwordHash = await bcrypt.hash("Test1234!", 10);
  const user = await prisma.user.create({ data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
  const client = await prisma.client.create({ data: { tenantId: tenant.id, nome: "Cliente", cognome: "Test" } });
  const vehicle = await prisma.vehicle.create({ data: { tenantId: tenant.id, clientId: client.id, marca: "Fiat", modello: "Panda", targa: `${suffix.slice(-6).toUpperCase()}` } });

  try {
    await prisma.aiAssistantLog.create({ data: { tenantId: tenant.id, domanda: "test" } });
    await prisma.aiAssistantLog.create({ data: { tenantId: tenant.id, domanda: "test2" } });
    await prisma.aiAnalysisLog.create({ data: { tenantId: tenant.id, vehicleId: vehicle.id } });
    await prisma.whatsappMessage.create({ data: { tenantId: tenant.id, vehicleId: vehicle.id, clientId: client.id, evento: "ACCETTAZIONE", testo: "test", telefono: "+390000000000", stato: "INVIATO" } });
    await prisma.usageEvent.create({ data: { tenantId: tenant.id, tipo: "EMAIL", dettaglio: "test" } });
    await prisma.usageEvent.create({ data: { tenantId: tenant.id, tipo: "API_ESTERNA", dettaglio: "stripe_checkout" } });
    await prisma.document.create({ data: { clientId: client.id, nome: "doc.pdf", url: "https://example.invalid/doc.pdf" } });
    await prisma.photo.create({ data: { vehicleId: vehicle.id, fase: "PRIMA", url: "https://example.invalid/foto.jpg" } });

    await t.test("i conteggi per il tenant sono corretti", async () => {
      const riepilogo = await riepilogoUsoTuttiTenant();
      const riga = riepilogo.find((r) => r.tenantId === tenant.id);
      assert.ok(riga, "il tenant deve comparire nel riepilogo");
      assert.equal(riga.ai.assistenteUsateMese, 2);
      assert.equal(riga.ai.analisiUsateMese, 1);
      assert.equal(riga.whatsapp.mese, 1);
      assert.equal(riga.email.mese, 1);
      assert.equal(riga.apiEsterne.mese, 1);
      assert.equal(riga.documenti.totale, 1);
      assert.equal(riga.foto.totale, 1);
      assert.equal(riga.ai.assistenteLimite, limiteAssistente({ piano: "STARTER", limiteAssistenteIAMensile: null }));
    });

    await t.test("GET /api/super-admin/usage: 401 senza token, 200 con token, riga presente", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/super-admin", superAdminRouter);
      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        assert.equal((await fetch(`${base}/api/super-admin/usage`)).status, 401);

        const email = `super.${suffix}@example.invalid`;
        const superPasswordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
        const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash: superPasswordHash } });
        try {
          const login = await fetch(`${base}/api/super-admin/login`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: "SuperTestPassword12345!" }),
          });
          const { token } = await login.json();
          const res = await fetch(`${base}/api/super-admin/usage`, { headers: { Authorization: `Bearer ${token}` } });
          assert.equal(res.status, 200);
          const dati = await res.json();
          assert.ok(dati.some((r) => r.tenantId === tenant.id));
        } finally {
          await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
        }
      } finally {
        server.close();
      }
    });
  } finally {
    await prisma.usageEvent.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.whatsappMessage.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.aiAnalysisLog.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.aiAssistantLog.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.photo.deleteMany({ where: { vehicleId: vehicle.id } });
    await prisma.document.deleteMany({ where: { clientId: client.id } });
    await prisma.vehicle.delete({ where: { id: vehicle.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test("Usage tracking: alert sul limite AI, in-app, una volta sola per soglia", async (t) => {
  const suffix = `alert_${Date.now()}`;
  // Piano con limite basso e prevedibile per rendere le soglie esatte.
  const tenant = await prisma.tenant.create({ data: { ragioneSociale: `Alert Test ${suffix}`, piano: "TRIAL", limiteAssistenteIAMensile: 10 } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `admin.${suffix}@example.invalid`, passwordHash: "x", ruolo: "ADMIN", emailVerificata: true, attivo: true } });

  try {
    await t.test("nessun alert sotto la soglia del 90%", async () => {
      await segnalaUsoAssistente(tenant, 8); // soglia90 = ceil(10*0.9) = 9
      const notifiche = await prisma.notification.findMany({ where: { tenantId: tenant.id, categoria: "AI" } });
      assert.equal(notifiche.length, 0);
    });

    await t.test("alert 'quasi raggiunto' esattamente al 90%", async () => {
      await segnalaUsoAssistente(tenant, 9);
      const notifiche = await prisma.notification.findMany({ where: { tenantId: tenant.id, categoria: "AI", userId: admin.id } });
      assert.equal(notifiche.length, 1);
      assert.match(notifiche[0].titolo, /quasi raggiunto/i);
    });

    await t.test("nessun secondo alert tra il 90% e il 100%", async () => {
      await segnalaUsoAssistente(tenant, 9); // stesso valore richiamato di nuovo: non deve duplicare
      const notifiche = await prisma.notification.findMany({ where: { tenantId: tenant.id, categoria: "AI", userId: admin.id } });
      assert.equal(notifiche.length, 1, "non deve creare una seconda notifica per lo stesso conteggio");
    });

    await t.test("alert 'raggiunto' esattamente al 100%, una notifica in più", async () => {
      await segnalaUsoAssistente(tenant, 10);
      const notifiche = await prisma.notification.findMany({ where: { tenantId: tenant.id, categoria: "AI", userId: admin.id }, orderBy: { createdAt: "asc" } });
      assert.equal(notifiche.length, 2);
      assert.match(notifiche[1].titolo, /raggiunto/i);
      assert.doesNotMatch(notifiche[1].titolo, /quasi/i);
    });
  } finally {
    await prisma.notification.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});
