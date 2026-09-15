// Punto 21 del prompt SaaS (audit log semantico): verifica che le azioni
// rilevanti (login, password modificata, ...) producano una riga
// leggibile in audit_logs con azione/metadata coerenti, e — più
// importante — che nessuna password o token finisca MAI in metadata,
// nemmeno per le rotte che la ricevono nel body.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-audit-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { authRouter } = await import("../src/routes/auth.js");
const { auditLogger } = await import("../src/middleware/audit.js");
const { requireAuth } = await import("../src/middleware/auth.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(auditLogger);
  app.use("/api/auth", authRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

async function ultimoLog(where) {
  // L'audit log è "fire and forget" (non bloccante): piccola attesa perché
  // la scrittura, avviata dopo l'invio della risposta, possa completarsi.
  await new Promise((r) => setTimeout(r, 300));
  return prisma.auditLog.findFirst({ where, orderBy: { createdAt: "desc" } });
}

test("Audit log: azioni semantiche, mai password/token in metadata", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });

  const suffix = Date.now();
  const email = `audit.test.${suffix}@example.invalid`;
  const created = { tenants: [] };

  try {
    await t.test("login riuscito registra azione=login con l'email ma senza password", async () => {
      const reg = await call("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          ragioneSociale: `Audit Test ${suffix}`, nomeAdmin: "A", cognomeAdmin: "B",
          email, password: "Test1234!Audit", condizioniAccettate: true,
        }),
      });
      const data = await reg.json();
      created.tenants.push(data.tenant.id);
      await prisma.user.update({ where: { id: data.user.id }, data: { emailVerificata: true } });

      const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "Test1234!Audit" }) });
      assert.equal(login.status, 200);

      const log = await ultimoLog({ percorso: "/api/auth/login", statusCode: 200 });
      assert.ok(log, "deve esserci una riga di audit per il login riuscito");
      assert.equal(log.azione, "login");
      assert.equal(log.metadata.email, email);
      assert.equal(JSON.stringify(log.metadata).toLowerCase().includes("password"), false);
      assert.ok(log.ip !== undefined);
    });

    await t.test("login fallito (credenziali sbagliate) non registra metadata", async () => {
      const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "sbagliata-qualsiasi" }) });
      assert.equal(login.status, 401);
      const log = await ultimoLog({ percorso: "/api/auth/login", statusCode: 401 });
      assert.ok(log, "un tentativo fallito deve comunque essere tracciato (statusCode 401)");
      assert.equal(log.metadata, null);
    });

    await t.test("cambia-password registra l'azione ma MAI la password stessa, vecchia o nuova", async () => {
      const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "Test1234!Audit" }) });
      const { token } = await login.json();

      const cambio = await call("/api/auth/cambia-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ passwordAttuale: "Test1234!Audit", nuovaPassword: "NuovaPassword5678!" }),
      });
      assert.equal(cambio.status, 200);

      const log = await ultimoLog({ percorso: "/api/auth/cambia-password" });
      assert.ok(log);
      assert.equal(log.azione, "password modificata");
      // Nessun campo della rotta è nell'elenco sicuro "campi" per questa
      // azione: metadata deve restare vuoto, garanzia strutturale che la
      // password non possa MAI finire nel log per una svista futura.
      assert.equal(log.metadata, null);
      const rigaGrezza = JSON.stringify(log);
      assert.equal(rigaGrezza.includes("Test1234"), false);
      assert.equal(rigaGrezza.includes("NuovaPassword5678"), false);
    });

    await t.test("un tentativo senza token (401) viene comunque tracciato, senza utente/tenant", async () => {
      const app2 = express();
      app2.use(express.json());
      app2.use(auditLogger);
      app2.use(requireAuth);
      app2.get("/protetta", (req, res) => res.json({ ok: true }));
      const server2 = app2.listen(0, "127.0.0.1");
      await new Promise((r) => server2.once("listening", r));
      try {
        const res = await fetch(`http://127.0.0.1:${server2.address().port}/protetta`);
        assert.equal(res.status, 401);
        await new Promise((r) => setTimeout(r, 300));
        const log = await prisma.auditLog.findFirst({ where: { percorso: "/protetta" }, orderBy: { createdAt: "desc" } });
        assert.ok(log);
        assert.equal(log.userId, null);
        assert.equal(log.tenantId, null);
      } finally {
        await new Promise((r) => server2.close(r));
      }
    });
  } finally {
    for (const tenantId of created.tenants) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
  }
});
