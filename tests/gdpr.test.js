// GDPR e privacy (punto 18 del prompt SaaS): export dati (tenant e per
// singolo cliente), richiesta di cancellazione account (registrata, non
// distruttiva), anonimizzazione cliente su richiesta. Contro l'app HTTP
// vera + database reale, dati creati e ripuliti a fine test.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-gdpr-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { gdprRouter } = await import("../src/routes/gdpr.js");
const { clientsRouter } = await import("../src/routes/clients.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/gdpr", gdprRouter);
  app.use("/api/clients", clientsRouter);
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

function tokenFor(user, tenantId) {
  return jwt.sign({ sub: user.id, tenantId, role: user.ruolo }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

test("GDPR: export, richiesta cancellazione account, anonimizzazione cliente", async (t) => {
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
  let tenant, admin, tecnico, tokenAdmin, tokenTecnico, client;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `GDPR Test ${suffix}` } });
    created.tenants.push(tenant.id);
    const passwordHash = await bcrypt.hash("Test1234!Gdpr", 10);
    admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Admin", cognome: "G", email: `gdpr.admin.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    tecnico = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "G", email: `gdpr.tecnico.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    tokenAdmin = tokenFor(admin, tenant.id);
    tokenTecnico = tokenFor(tecnico, tenant.id);
    client = await prisma.client.create({ data: { tenantId: tenant.id, nome: "Mario", cognome: "Rossi", telefono: "3331234567", email: `mario.rossi.${suffix}@example.invalid`, codiceFiscale: "RSSMRA80A01H501U" } });

    await t.test("export tenant è riservato ad ADMIN", async () => {
      const resTecnico = await call("/api/gdpr/export", tokenTecnico);
      assert.equal(resTecnico.status, 403);

      const resAdmin = await call("/api/gdpr/export", tokenAdmin);
      assert.equal(resAdmin.status, 200);
      const data = await resAdmin.json();
      assert.ok(Array.isArray(data.clienti));
      assert.ok(data.clienti.some((c) => c.id === client.id));
      assert.ok(!("passwordHash" in (data.utenti[0] || {})), "l'export non deve mai contenere passwordHash");
    });

    await t.test("export tenant registra una GdprRichiesta completata", async () => {
      const richieste = await prisma.gdprRichiesta.findMany({ where: { tenantId: tenant.id, tipo: "EXPORT_DATI", clienteId: null } });
      assert.ok(richieste.length >= 1);
      assert.equal(richieste[0].stato, "COMPLETATA");
    });

    await t.test("export di un singolo cliente è riservato ad ADMIN/AMMINISTRAZIONE, non a TECNICO", async () => {
      const resTecnico = await call(`/api/clients/${client.id}/export`, tokenTecnico);
      assert.equal(resTecnico.status, 403);

      const resAdmin = await call(`/api/clients/${client.id}/export`, tokenAdmin);
      assert.equal(resAdmin.status, 200);
      const data = await resAdmin.json();
      assert.equal(data.cliente.id, client.id);
      assert.equal(data.cliente.nome, "Mario");
    });

    await t.test("richiesta di cancellazione account non elimina nulla, solo registra la richiesta", async () => {
      const resTecnico = await call("/api/gdpr/richiesta-cancellazione-account", tokenTecnico, { method: "POST", body: JSON.stringify({}) });
      assert.equal(resTecnico.status, 403, "solo ADMIN può richiedere la cancellazione dell'account");

      const resAdmin = await call("/api/gdpr/richiesta-cancellazione-account", tokenAdmin, { method: "POST", body: JSON.stringify({ note: "test" }) });
      assert.equal(resAdmin.status, 201);
      const data = await resAdmin.json();
      assert.equal(data.richiesta.stato, "IN_ATTESA");

      // Nessun dato deve essere stato toccato: il tenant e l'utente esistono ancora.
      const tenantAncoraEsistente = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      assert.ok(tenantAncoraEsistente, "il tenant non deve essere stato cancellato automaticamente");

      const resRichieste = await call("/api/gdpr/richieste", tokenAdmin);
      const richieste = await resRichieste.json();
      assert.ok(richieste.some((r) => r.tipo === "CANCELLAZIONE_ACCOUNT" && r.stato === "IN_ATTESA"));
    });

    await t.test("richiesta di cancellazione cliente anonimizza i dati identificativi ma non elimina il record", async () => {
      const resTecnico = await call(`/api/clients/${client.id}/richiesta-cancellazione`, tokenTecnico, { method: "POST", body: JSON.stringify({}) });
      assert.equal(resTecnico.status, 403, "solo ADMIN può richiedere la cancellazione di un cliente");

      const resAdmin = await call(`/api/clients/${client.id}/richiesta-cancellazione`, tokenAdmin, { method: "POST", body: JSON.stringify({}) });
      assert.equal(resAdmin.status, 200);
      const data = await resAdmin.json();
      assert.equal(data.cliente.datiAnonimizzati, true);
      assert.notEqual(data.cliente.nome, "Mario");
      assert.equal(data.cliente.telefono, null);
      assert.equal(data.cliente.email, null);
      assert.equal(data.cliente.codiceFiscale, null);

      const rigaAncoraEsistente = await prisma.client.findUnique({ where: { id: client.id } });
      assert.ok(rigaAncoraEsistente, "il record cliente deve continuare a esistere (anonimizzato, non cancellato)");
    });

    await t.test("una seconda richiesta di cancellazione sullo stesso cliente è un no-op sicuro", async () => {
      const res = await call(`/api/clients/${client.id}/richiesta-cancellazione`, tokenAdmin, { method: "POST", body: JSON.stringify({}) });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.giaAnonimizzato, true);
    });
  } finally {
    for (const tenantId of created.tenants) {
      await prisma.gdprRichiesta.deleteMany({ where: { tenantId } });
      await prisma.client.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
  }
});
