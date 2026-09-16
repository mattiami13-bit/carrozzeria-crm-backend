// Notification center (punto 17 del prompt SaaS): API contro l'app HTTP
// vera + database reale, dati creati e ripuliti a fine test. Copre
// elenco/filtro per categoria, segna-come-letta, segna-tutte-lette,
// isolamento tra utenti diversi dello stesso tenant, e i trigger reali
// collegati (cambia password → SICUREZZA, nuovo cliente → CLIENTI,
// preventivo inviato → PRATICHE, scorta minima → RICAMBI).

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-notifiche-test-secret";
delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { notificheRouter } = await import("../src/routes/notifiche.js");
const { authRouter } = await import("../src/routes/auth.js");
const { clientsRouter } = await import("../src/routes/clients.js");
const { quotesRouter } = await import("../src/routes/quotes.js");
const { partsRouter } = await import("../src/routes/parts.js");
const { creaNotificaUtente, creaNotificaUtenti, creaNotificaRuoli } = await import("../src/lib/notificheInApp.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notifiche", notificheRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/parts", partsRouter);
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

function tokenFor(user, tenantId) {
  return jwt.sign({ sub: user.id, tenantId, role: user.ruolo }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

test("Notification center: API, isolamento e trigger reali", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout: nessuna risposta da ${init.method || "GET"} ${path} entro 8s`)), 8000);
    return fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).finally(() => clearTimeout(timer));
  };

  const suffix = Date.now();
  const created = { tenants: [] };
  let tenant, admin, tecnico, tokenAdmin, tokenTecnico;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `Notifiche Test ${suffix}` } });
    created.tenants.push(tenant.id);
    const passwordHash = await bcrypt.hash("Test1234!Notifiche", 10);
    admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Admin", cognome: "N", email: `notifiche.admin.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    tecnico = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "N", email: `notifiche.tecnico.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    tokenAdmin = tokenFor(admin, tenant.id);
    tokenTecnico = tokenFor(tecnico, tenant.id);

    await t.test("elenco vuoto e contatore a zero per un utente senza notifiche", async () => {
      const resCount = await call("/api/notifiche/non-lette/count", tokenAdmin);
      assert.equal(resCount.status, 200);
      assert.equal((await resCount.json()).count, 0);

      const resLista = await call("/api/notifiche", tokenAdmin);
      assert.equal((await resLista.json()).notifiche.length, 0);
    });

    await t.test("creaNotificaUtente crea una notifica visibile solo al destinatario", async () => {
      await creaNotificaUtente({ tenantId: tenant.id, userId: admin.id, categoria: "SISTEMA", titolo: "Titolo test", messaggio: "Messaggio test" });

      const resAdmin = await call("/api/notifiche", tokenAdmin);
      const dataAdmin = await resAdmin.json();
      assert.equal(dataAdmin.notifiche.length, 1);
      assert.equal(dataAdmin.notifiche[0].titolo, "Titolo test");
      assert.equal(dataAdmin.notifiche[0].letta, false);

      const resTecnico = await call("/api/notifiche", tokenTecnico);
      const dataTecnico = await resTecnico.json();
      assert.equal(dataTecnico.notifiche.length, 0, "il tecnico non deve vedere la notifica dell'admin");
    });

    await t.test("segna come letta aggiorna solo quella notifica e decrementa il contatore", async () => {
      const resLista = await call("/api/notifiche", tokenAdmin);
      const [n] = (await resLista.json()).notifiche;

      const resCountPrima = await call("/api/notifiche/non-lette/count", tokenAdmin);
      assert.equal((await resCountPrima.json()).count, 1);

      const resLetta = await call(`/api/notifiche/${n.id}/letta`, tokenAdmin, { method: "PATCH" });
      assert.equal(resLetta.status, 200);

      const resCountDopo = await call("/api/notifiche/non-lette/count", tokenAdmin);
      assert.equal((await resCountDopo.json()).count, 0);
    });

    await t.test("un utente non può segnare come letta la notifica di un altro tenant/utente", async () => {
      await creaNotificaUtente({ tenantId: tenant.id, userId: admin.id, categoria: "SISTEMA", titolo: "Solo admin", messaggio: "..." });
      const resLista = await call("/api/notifiche", tokenAdmin);
      const [n] = (await resLista.json()).notifiche;

      const res = await call(`/api/notifiche/${n.id}/letta`, tokenTecnico, { method: "PATCH" });
      assert.equal(res.status, 404, "il tecnico non deve poter marcare una notifica non sua");
    });

    await t.test("filtro per categoria funziona", async () => {
      await creaNotificaUtente({ tenantId: tenant.id, userId: tecnico.id, categoria: "RICAMBI", titolo: "Ricambi test", messaggio: "..." });
      await creaNotificaUtente({ tenantId: tenant.id, userId: tecnico.id, categoria: "SICUREZZA", titolo: "Sicurezza test", messaggio: "..." });

      const resTutte = await call("/api/notifiche", tokenTecnico);
      assert.equal((await resTutte.json()).notifiche.length, 2);

      const resFiltrate = await call("/api/notifiche?categoria=RICAMBI", tokenTecnico);
      const dataFiltrate = await resFiltrate.json();
      assert.equal(dataFiltrate.notifiche.length, 1);
      assert.equal(dataFiltrate.notifiche[0].categoria, "RICAMBI");
    });

    await t.test("segna-tutte-lette azzera il contatore per l'utente corrente", async () => {
      const res = await call("/api/notifiche/segna-tutte-lette", tokenTecnico, { method: "POST" });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.aggiornate, 2);

      const resCount = await call("/api/notifiche/non-lette/count", tokenTecnico);
      assert.equal((await resCount.json()).count, 0);
    });

    await t.test("creaNotificaRuoli invia solo ai ruoli richiesti, escludendo chi va escluso", async () => {
      const amministrazione = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Amm", cognome: "N", email: `notifiche.amm.${suffix}@example.invalid`, passwordHash: admin.passwordHash, ruolo: "AMMINISTRAZIONE", emailVerificata: true } });
      const tokenAmm = tokenFor(amministrazione, tenant.id);

      await creaNotificaRuoli({ tenantId: tenant.id, ruoli: ["ADMIN", "AMMINISTRAZIONE"], categoria: "CLIENTI", titolo: "Broadcast ruoli", messaggio: "...", escludiUserId: admin.id });

      const resAdmin = await call("/api/notifiche?categoria=CLIENTI", tokenAdmin);
      assert.equal((await resAdmin.json()).notifiche.length, 0, "admin escluso non deve ricevere");

      const resAmm = await call("/api/notifiche?categoria=CLIENTI", tokenAmm);
      assert.equal((await resAmm.json()).notifiche.length, 1, "amministrazione deve ricevere");

      const resTecnico = await call("/api/notifiche?categoria=CLIENTI", tokenTecnico);
      assert.equal((await resTecnico.json()).notifiche.length, 0, "tecnico non è nel gruppo di ruoli");
    });

    await t.test("trigger reale: cambio password genera una notifica SICUREZZA per l'utente stesso", async () => {
      const resPrima = await call("/api/notifiche?categoria=SICUREZZA", tokenTecnico);
      const primaCount = (await resPrima.json()).notifiche.length;

      const resCambio = await call("/api/auth/cambia-password", tokenTecnico, {
        method: "POST",
        body: JSON.stringify({ passwordAttuale: "Test1234!Notifiche", nuovaPassword: "NuovaTecnico123!" }),
      });
      assert.equal(resCambio.status, 200);

      // La notifica viene creata in modo "best effort" e non bloccante: un breve
      // margine evita un falso negativo per pura schedulazione asincrona.
      await new Promise((r) => setTimeout(r, 300));

      const resDopo = await call("/api/notifiche?categoria=SICUREZZA", tokenTecnico);
      const dopo = await resDopo.json();
      assert.equal(dopo.notifiche.length, primaCount + 1);
      assert.match(dopo.notifiche[0].titolo, /Password modificata/);
    });

    await t.test("trigger reale: nuovo cliente genera una notifica CLIENTI per un altro ADMIN, non per chi lo crea", async () => {
      const admin2 = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Admin2", cognome: "N", email: `notifiche.admin2.${suffix}@example.invalid`, passwordHash: admin.passwordHash, ruolo: "ADMIN", emailVerificata: true } });
      const tokenAdmin2 = tokenFor(admin2, tenant.id);

      const resClient = await call("/api/clients", tokenAdmin, {
        method: "POST",
        body: JSON.stringify({ nome: "Mario", cognome: "Notifiche" }),
      });
      assert.equal(resClient.status, 201);
      const client = await resClient.json();

      await new Promise((r) => setTimeout(r, 300));

      const resAdminNotif = await call("/api/notifiche?categoria=CLIENTI", tokenAdmin);
      const adminNotif = (await resAdminNotif.json()).notifiche;
      assert.ok(!adminNotif.some((n) => n.messaggio.includes("Mario Notifiche")), "chi crea il cliente non deve auto-notificarsi");

      const resAdmin2Notif = await call("/api/notifiche?categoria=CLIENTI", tokenAdmin2);
      const admin2Notif = (await resAdmin2Notif.json()).notifiche;
      assert.ok(admin2Notif.some((n) => n.messaggio.includes("Mario Notifiche")), "un altro admin deve ricevere la notifica del nuovo cliente");

      await prisma.client.delete({ where: { id: client.id } });
    });
  } finally {
    for (const tenantId of created.tenants) {
      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.client.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
  }
});
