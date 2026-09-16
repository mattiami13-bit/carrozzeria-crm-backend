// Punto 37 (supporto cliente): un ticket è la stessa entità per
// "contatta supporto" / "segnala problema" / "richiedi funzione",
// distinta solo dalla categoria. Verifica con database reale: creazione,
// isolamento tra tenant, visibilità condivisa tra colleghi dello stesso
// tenant (non solo di chi apre il ticket), e la gestione lato
// super-admin (visibilità su tutti i tenant, cambio stato).

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-support-test-secret";
delete process.env.RESEND_API_KEY;

const { prisma } = await import("../src/lib/prisma.js");
const { supportRouter } = await import("../src/routes/support.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/support", supportRouter);
  app.use("/api/super-admin", superAdminRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Supporto cliente: crea ticket, isolamento tra tenant, visibilità condivisa, gestione super-admin", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("Test1234!", 10);

  const tenantA = await prisma.tenant.create({ data: { ragioneSociale: `Support Test A ${suffix}` } });
  const adminA = await prisma.user.create({ data: { tenantId: tenantA.id, nome: "Admin", cognome: "A", email: `admin.a.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
  const tecnicoA = await prisma.user.create({ data: { tenantId: tenantA.id, nome: "Tecnico", cognome: "A", email: `tec.a.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
  const tenantB = await prisma.tenant.create({ data: { ragioneSociale: `Support Test B ${suffix}` } });
  const adminB = await prisma.user.create({ data: { tenantId: tenantB.id, nome: "Admin", cognome: "B", email: `admin.b.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });

  const tokenAdminA = jwt.sign({ sub: adminA.id, tenantId: tenantA.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const tokenTecnicoA = jwt.sign({ sub: tecnicoA.id, tenantId: tenantA.id, role: "TECNICO" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const tokenAdminB = jwt.sign({ sub: adminB.id, tenantId: tenantB.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  const superEmail = `super.support.${suffix}@example.invalid`;
  const superPasswordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
  const superAdmin = await prisma.superAdmin.create({ data: { email: superEmail, passwordHash: superPasswordHash } });

  let ticketId;

  try {
    await t.test("un tecnico può aprire un ticket (segnala un problema)", async () => {
      const res = await fetch(`${base}/api/support/ticket`, {
        method: "POST", headers: { Authorization: `Bearer ${tokenTecnicoA}`, "Content-Type": "application/json" },
        body: JSON.stringify({ categoria: "BUG", priorita: "ALTA", messaggio: "Il pulsante salva non funziona sulla scheda veicolo" }),
      });
      assert.equal(res.status, 201);
      const ticket = await res.json();
      ticketId = ticket.id;
      assert.equal(ticket.stato, "APERTO");
      assert.equal(ticket.categoria, "BUG");
    });

    await t.test("categoria non valida: 400", async () => {
      const res = await fetch(`${base}/api/support/ticket`, {
        method: "POST", headers: { Authorization: `Bearer ${tokenAdminA}`, "Content-Type": "application/json" },
        body: JSON.stringify({ categoria: "INVENTATA", messaggio: "x" }),
      });
      assert.equal(res.status, 400);
    });

    await t.test("un ADMIN dello stesso tenant vede il ticket aperto dal tecnico (visibilità condivisa)", async () => {
      const res = await fetch(`${base}/api/support/ticket`, { headers: { Authorization: `Bearer ${tokenAdminA}` } });
      assert.equal(res.status, 200);
      const tickets = await res.json();
      assert.ok(tickets.some((t) => t.id === ticketId));
    });

    await t.test("un ADMIN di un altro tenant NON vede il ticket (isolamento)", async () => {
      const res = await fetch(`${base}/api/support/ticket`, { headers: { Authorization: `Bearer ${tokenAdminB}` } });
      const tickets = await res.json();
      assert.ok(!tickets.some((t) => t.id === ticketId));
    });

    await t.test("nessun token: 401", async () => {
      assert.equal((await fetch(`${base}/api/support/ticket`)).status, 401);
    });

    let superToken;
    await t.test("login super-admin di test", async () => {
      const res = await fetch(`${base}/api/super-admin/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: superEmail, password: "SuperTestPassword12345!" }),
      });
      superToken = (await res.json()).token;
      assert.ok(superToken);
    });

    await t.test("super-admin vede il ticket con dati di tenant e utente", async () => {
      const res = await fetch(`${base}/api/super-admin/tickets?stato=APERTO`, { headers: { Authorization: `Bearer ${superToken}` } });
      assert.equal(res.status, 200);
      const tickets = await res.json();
      const trovato = tickets.find((t) => t.id === ticketId);
      assert.ok(trovato);
      assert.equal(trovato.tenant.ragioneSociale, `Support Test A ${suffix}`);
      assert.equal(trovato.user.email, `tec.a.${suffix}@example.invalid`);
    });

    await t.test("super-admin fa avanzare lo stato del ticket", async () => {
      const res = await fetch(`${base}/api/super-admin/tickets/${ticketId}/stato`, {
        method: "PATCH", headers: { Authorization: `Bearer ${superToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "IN_LAVORAZIONE" }),
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).stato, "IN_LAVORAZIONE");
    });

    await t.test("un tenant normale non può modificare lo stato di un ticket via super-admin", async () => {
      const res = await fetch(`${base}/api/super-admin/tickets/${ticketId}/stato`, {
        method: "PATCH", headers: { Authorization: `Bearer ${tokenAdminA}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "CHIUSO" }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("ticket inesistente: 404", async () => {
      const res = await fetch(`${base}/api/super-admin/tickets/non-esiste/stato`, {
        method: "PATCH", headers: { Authorization: `Bearer ${superToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "CHIUSO" }),
      });
      assert.equal(res.status, 404);
    });
  } finally {
    server.close();
    if (ticketId) await prisma.ticket.deleteMany({ where: { id: ticketId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [adminA.id, tecnicoA.id, adminB.id] } } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } }).catch(() => {});
    await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
  }
});
