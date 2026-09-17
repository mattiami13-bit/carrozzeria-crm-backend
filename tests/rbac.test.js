// Punto 29 (test automatici): RBAC e invito utente. Verifica che le
// rotte riservate all'ADMIN respingano davvero gli altri ruoli, e che
// l'invito di un nuovo utente assegni correttamente il ruolo richiesto
// (mai un ruolo diverso da quello passato, mai ADMIN di default).

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-rbac-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { usersRouter } = await import("../src/routes/users.js");
const { gdprRouter } = await import("../src/routes/gdpr.js");
const { billingRouter } = await import("../src/routes/billing.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRouter);
  app.use("/api/gdpr", gdprRouter);
  app.use("/api/billing", billingRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("RBAC: rotte riservate all'ADMIN, e invito utente assegna il ruolo corretto", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("Test1234!", 10);
  let tenant, admin, tecnico, tokenAdmin, tokenTecnico;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `RBAC Test ${suffix}` } });
    admin = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Admin", cognome: "R", email: `rbac.admin.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    tecnico = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "R", email: `rbac.tecnico.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    tokenAdmin = jwt.sign({ sub: admin.id, tenantId: tenant.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
    tokenTecnico = jwt.sign({ sub: tecnico.id, tenantId: tenant.id, role: "TECNICO" }, process.env.JWT_SECRET, { expiresIn: "1h" });

    await t.test("un TECNICO non può invitare un nuovo utente", async () => {
      const res = await call("/api/users", tokenTecnico, {
        method: "POST",
        body: JSON.stringify({ nome: "Nuovo", cognome: "Utente", email: `rbac.nuovo.${suffix}@example.invalid`, password: "Test1234!Nuovo" }),
      });
      assert.equal(res.status, 403);
    });

    await t.test("un TECNICO non può esportare i dati del tenant (GDPR)", async () => {
      const res = await call("/api/gdpr/export", tokenTecnico);
      assert.equal(res.status, 403);
    });

    await t.test("un TECNICO non può avviare un checkout di fatturazione", async () => {
      const res = await call("/api/billing/checkout", tokenTecnico, { method: "POST", body: JSON.stringify({ piano: "PRO" }) });
      assert.equal(res.status, 403);
    });

    await t.test("un ADMIN può invitare un nuovo utente con il ruolo richiesto", async () => {
      const res = await call("/api/users", tokenAdmin, {
        method: "POST",
        body: JSON.stringify({ nome: "Nuovo", cognome: "Utente", email: `rbac.nuovo.${suffix}@example.invalid`, password: "Test1234!Nuovo", ruolo: "AMMINISTRAZIONE" }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.ruolo, "AMMINISTRAZIONE", "il ruolo assegnato deve essere esattamente quello richiesto, non un default");
      const salvato = await prisma.user.findUnique({ where: { id: data.id } });
      assert.equal(salvato.tenantId, tenant.id, "il nuovo utente deve appartenere allo stesso tenant di chi lo invita");
    });

    await t.test("un utente invitato senza ruolo esplicito diventa TECNICO, mai ADMIN per default", async () => {
      const res = await call("/api/users", tokenAdmin, {
        method: "POST",
        body: JSON.stringify({ nome: "Senza", cognome: "Ruolo", email: `rbac.senzaruolo.${suffix}@example.invalid`, password: "Test1234!Nuovo" }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.ruolo, "TECNICO");
    });

    // Punto 49: il pulsante "Crea utente" nel gestionale non aveva mai
    // avuto una controparte UI prima di questo audit; aggiungendola si è
    // scoperto che il limite utenti del piano (già applicato al cambio
    // piano in billing.js) non era mai stato applicato alla creazione
    // diretta di un utente, permettendo di superare a piacere i posti
    // inclusi nel piano. Verifica che ora sia bloccato.
    await t.test("creare un utente oltre il limite del piano (STARTER, 3 inclusi) è rifiutato con 409", async () => {
      await prisma.tenant.update({ where: { id: tenant.id }, data: { piano: "STARTER" } });
      // Il tenant di test ha già admin + tecnico + i 2 creati sopra = 4 utenti attivi, già oltre i 3 dello Starter.
      const res = await call("/api/users", tokenAdmin, {
        method: "POST",
        body: JSON.stringify({ nome: "Oltre", cognome: "Limite", email: `rbac.oltrelimite.${suffix}@example.invalid`, password: "Test1234!Nuovo" }),
      });
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.match(data.error, /include 3 utenti/);
      const creato = await prisma.user.findUnique({ where: { email: `rbac.oltrelimite.${suffix}@example.invalid` } });
      assert.equal(creato, null, "l'utente non deve essere stato creato");
    });
  } finally {
    if (tenant) {
      await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});
