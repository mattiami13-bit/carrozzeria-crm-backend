// Punto 38 (changelog, "NOVITÀ"): la tabella nasce vuota per costruzione
// (nessuno storico inventato) — verifica che GET /api/changelog gestisca
// correttamente sia lo stato vuoto sia le voci reali pubblicate dal
// super-admin, e che il CRUD sia riservato al super-admin.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

const { prisma } = await import("../src/lib/prisma.js");
const { changelogRouter } = await import("../src/routes/changelog.js");
const { superAdminRouter } = await import("../src/routes/superAdmin.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/changelog", changelogRouter);
  app.use("/api/super-admin", superAdminRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Changelog: nasce vuoto, il super-admin pubblica voci reali, ordinamento e sicurezza", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const created = [];

  const email = `super.changelog.${suffix}@example.invalid`;
  const passwordHash = await bcrypt.hash("SuperTestPassword12345!", 10);
  const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash } });

  try {
    let token;
    await t.test("login super-admin di test", async () => {
      const res = await fetch(`${base}/api/super-admin/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "SuperTestPassword12345!" }),
      });
      token = (await res.json()).token;
      assert.ok(token);
    });

    await t.test("modificare senza token: 401", async () => {
      const res = await fetch(`${base}/api/super-admin/changelog`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: "x", descrizione: "y" }),
      });
      assert.equal(res.status, 401);
    });

    let vecchiaId, nuovaId;
    await t.test("POST crea due voci in date diverse", async () => {
      const vecchia = await fetch(`${base}/api/super-admin/changelog`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: `Voce vecchia ${suffix}`, descrizione: "Descrizione vecchia", data: "2026-01-01T00:00:00.000Z" }),
      });
      assert.equal(vecchia.status, 201);
      vecchiaId = (await vecchia.json()).id;
      created.push(vecchiaId);

      const nuova = await fetch(`${base}/api/super-admin/changelog`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: `Voce nuova ${suffix}`, descrizione: "Descrizione nuova", data: "2026-06-01T00:00:00.000Z" }),
      });
      assert.equal(nuova.status, 201);
      nuovaId = (await nuova.json()).id;
      created.push(nuovaId);
    });

    await t.test("GET /api/changelog (pubblica) le include, ordinate dalla più recente", async () => {
      const res = await fetch(`${base}/api/changelog`);
      assert.equal(res.status, 200);
      const voci = await res.json();
      const iNuova = voci.findIndex((v) => v.id === nuovaId);
      const iVecchia = voci.findIndex((v) => v.id === vecchiaId);
      assert.ok(iNuova >= 0 && iVecchia >= 0);
      assert.ok(iNuova < iVecchia, "la voce più recente deve comparire prima");
    });

    await t.test("PATCH modifica una voce", async () => {
      const res = await fetch(`${base}/api/super-admin/changelog/${vecchiaId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: "Titolo corretto" }),
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).titolo, "Titolo corretto");
    });

    await t.test("dati non validi (titolo vuoto): 400", async () => {
      const res = await fetch(`${base}/api/super-admin/changelog`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: "", descrizione: "x" }),
      });
      assert.equal(res.status, 400);
    });

    await t.test("DELETE rimuove la voce; una seconda PATCH dà 404", async () => {
      const res = await fetch(`${base}/api/super-admin/changelog/${nuovaId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 204);
      created.splice(created.indexOf(nuovaId), 1);
      const secondo = await fetch(`${base}/api/super-admin/changelog/${nuovaId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ titolo: "x" }),
      });
      assert.equal(secondo.status, 404);
    });
  } finally {
    server.close();
    if (created.length) await prisma.changelogEntry.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await prisma.superAdmin.delete({ where: { id: superAdmin.id } }).catch(() => {});
  }
});

test("Changelog: GET pubblica funziona anche a tabella vuota (nessuno storico inventato)", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/changelog`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  } finally {
    server.close();
  }
});
