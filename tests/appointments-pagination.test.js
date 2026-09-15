// Punto 25 (performance): senza from/to, l'elenco appuntamenti non deve
// più restituire l'intero storico del tenant (crescerebbe senza limite),
// ma una finestra ragionevole intorno a oggi. Con from/to espliciti il
// comportamento resta quello di sempre.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-appointments-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { appointmentsRouter } = await import("../src/routes/appointments.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/appointments", appointmentsRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Appuntamenti: senza from/to usa una finestra intorno a oggi, non tutto lo storico", async () => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  let tenant, user, token;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `Appt Perf ${suffix}` } });
    const passwordHash = await bcrypt.hash("Test1234!", 10);
    user = await prisma.user.create({ data: { tenantId: tenant.id, nome: "A", cognome: "B", email: `appt.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    token = jwt.sign({ sub: user.id, tenantId: tenant.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });

    const oggi = new Date();
    const vecchio = new Date(oggi.getTime() - 365 * 24 * 60 * 60 * 1000); // un anno fa
    const vicino = new Date(oggi.getTime() + 5 * 24 * 60 * 60 * 1000); // tra 5 giorni

    await prisma.appointment.create({ data: { tenantId: tenant.id, titolo: "Vecchio", inizio: vecchio, fine: new Date(vecchio.getTime() + 3600000) } });
    await prisma.appointment.create({ data: { tenantId: tenant.id, titolo: "Vicino", inizio: vicino, fine: new Date(vicino.getTime() + 3600000) } });

    const senzaRange = await fetch(`${base}/api/appointments`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const titoli = senzaRange.map((a) => a.titolo);
    assert.ok(titoli.includes("Vicino"), "l'appuntamento vicino a oggi deve comparire nella finestra di default");
    assert.equal(titoli.includes("Vecchio"), false, "un appuntamento di un anno fa non deve comparire senza un range esplicito");

    const conRangeAmpio = await fetch(`${base}/api/appointments?from=${vecchio.toISOString()}&to=${oggi.toISOString()}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    assert.ok(conRangeAmpio.map((a) => a.titolo).includes("Vecchio"), "con un range esplicito che lo include, l'appuntamento vecchio deve comparire");
  } finally {
    if (tenant) {
      await prisma.appointment.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
  }
});
