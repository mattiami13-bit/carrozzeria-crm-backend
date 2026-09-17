// Punto 43 (export dati, "OWNER: ESPORTA DATI CARROZZERIA"): verifica
// con Supabase Storage reale (nessun mock) il flusso asincrono completo
// — richiesta, costruzione in background, link temporaneo firmato,
// scadenza, isolamento tra tenant — e che non invii email vere.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-data-export-test-secret";
delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { supabase, DATA_EXPORTS_BUCKET } = await import("../src/lib/supabase.js");
const { gdprRouter } = await import("../src/routes/gdpr.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/gdpr", gdprRouter);
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

function tokenFor(user, tenantId) {
  return jwt.sign({ sub: user.id, tenantId, role: user.ruolo }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

async function attendiCompletamento(base, token, id, timeoutMs = 15000) {
  const scadenza = Date.now() + timeoutMs;
  while (Date.now() < scadenza) {
    const res = await fetch(`${base}/api/gdpr/export-asincrono`, { headers: { Authorization: `Bearer ${token}` } });
    const lista = await res.json();
    const riga = lista.find((r) => r.id === id);
    if (riga && riga.stato !== "IN_CORSO") return riga;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timeout in attesa del completamento dell'export");
}

test("Export dati asincrono: richiesta, completamento reale, link temporaneo, isolamento tra tenant", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  const suffix = Date.now();
  const created = { tenants: [], storagePaths: [] };
  let tenant, admin, tecnico, tokenAdmin, tokenTecnico, altroTenant, altroAdmin, tokenAltroAdmin;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `Export Test ${suffix}` } });
    created.tenants.push(tenant.id);
    const passwordHash = await bcrypt.hash("Test1234!Export", 10);
    admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Admin", cognome: "E", email: `export.admin.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    tecnico = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "E", email: `export.tecnico.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    tokenAdmin = tokenFor(admin, tenant.id);
    tokenTecnico = tokenFor(tecnico, tenant.id);

    altroTenant = await prisma.tenant.create({ data: { ragioneSociale: `Export Test Altro ${suffix}` } });
    created.tenants.push(altroTenant.id);
    altroAdmin = await prisma.user.create({ data: { tenantId: altroTenant.id, nome: "Admin", cognome: "Altro", email: `export.altro.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    tokenAltroAdmin = tokenFor(altroAdmin, altroTenant.id);

    let exportId;
    await t.test("solo ADMIN può avviare un export asincrono; risponde subito 202 IN_CORSO", async () => {
      const resTecnico = await call("/api/gdpr/export-asincrono", tokenTecnico, { method: "POST" });
      assert.equal(resTecnico.status, 403);

      const res = await call("/api/gdpr/export-asincrono", tokenAdmin, { method: "POST" });
      assert.equal(res.status, 202);
      const data = await res.json();
      assert.equal(data.stato, "IN_CORSO");
      exportId = data.id;
    });

    await t.test("l'export si completa davvero in background (Supabase Storage reale)", async () => {
      const riga = await attendiCompletamento(base, tokenAdmin, exportId);
      assert.equal(riga.stato, "PRONTO");
      assert.ok(riga.scadenza);
      const dbRow = await prisma.dataExportRequest.findUnique({ where: { id: exportId } });
      created.storagePaths.push(dbRow.storagePath);
      assert.ok(dbRow.storagePath.startsWith(`${tenant.id}/`), "il file deve stare nella cartella del tenant corretto");
    });

    await t.test("il link di download è temporaneo, firmato, e punta ai dati veri del tenant", async () => {
      const res = await call(`/api/gdpr/export-asincrono/${exportId}/download`, tokenAdmin);
      assert.equal(res.status, 200);
      const { url } = await res.json();
      assert.ok(url.includes("token="), "deve essere una URL firmata, non un path diretto");

      const scaricato = await fetch(url);
      assert.equal(scaricato.status, 200);
      const contenuto = await scaricato.json();
      assert.equal(contenuto.tenant.ragioneSociale, `Export Test ${suffix}`);
    });

    await t.test("un ADMIN di un altro tenant non può scaricare questo export (404, non 403: nessun indizio che esista)", async () => {
      const res = await call(`/api/gdpr/export-asincrono/${exportId}/download`, tokenAltroAdmin);
      assert.equal(res.status, 404);
    });

    await t.test("un export IN_CORSO risponde 409 al tentativo di download", async () => {
      const inCorso = await prisma.dataExportRequest.create({ data: { tenantId: tenant.id, richiedenteId: admin.id } });
      const res = await call(`/api/gdpr/export-asincrono/${inCorso.id}/download`, tokenAdmin);
      assert.equal(res.status, 409);
      await prisma.dataExportRequest.delete({ where: { id: inCorso.id } });
    });

    await t.test("un export scaduto risponde 410 e non genera più un link", async () => {
      const scaduto = await prisma.dataExportRequest.create({
        data: { tenantId: tenant.id, richiedenteId: admin.id, stato: "PRONTO", storagePath: "percorso/inventato.json", scadenza: new Date(Date.now() - 1000) },
      });
      const res = await call(`/api/gdpr/export-asincrono/${scaduto.id}/download`, tokenAdmin);
      assert.equal(res.status, 410);
      await prisma.dataExportRequest.delete({ where: { id: scaduto.id } });
    });

    await t.test("un export FALLITO risponde 410 con un messaggio chiaro", async () => {
      const fallito = await prisma.dataExportRequest.create({ data: { tenantId: tenant.id, richiedenteId: admin.id, stato: "FALLITO", erroreMessaggio: "test" } });
      const res = await call(`/api/gdpr/export-asincrono/${fallito.id}/download`, tokenAdmin);
      assert.equal(res.status, 410);
      await prisma.dataExportRequest.delete({ where: { id: fallito.id } });
    });

    await t.test("GET /export-asincrono elenca solo le richieste del proprio tenant", async () => {
      const res = await call("/api/gdpr/export-asincrono", tokenAltroAdmin);
      const lista = await res.json();
      assert.ok(!lista.some((r) => r.id === exportId));
    });
  } finally {
    server.close();
    if (created.storagePaths.length) {
      await supabase.storage.from(DATA_EXPORTS_BUCKET).remove(created.storagePaths.filter(Boolean)).catch(() => {});
    }
    await prisma.dataExportRequest.deleteMany({ where: { tenantId: { in: created.tenants } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { tenantId: { in: created.tenants } } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } }).catch(() => {});
  }
});
