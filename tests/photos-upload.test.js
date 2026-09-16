// Punto 29 (test automatici, "upload protetto"): verifica che il
// caricamento foto richieda autenticazione, rifiuti un veicolo di un
// altro tenant, e rifiuti file che non sono immagini — contro l'app
// HTTP vera e Supabase Storage reale (nessun mock).

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-photos-upload-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { photosRouter } = await import("../src/routes/photos.js");

function buildApp() {
  const app = express();
  app.use("/api", photosRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  return app;
}

test("Upload foto: protetto da autenticazione, isolamento tenant, e tipo file", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("Test1234!", 10);
  let tenantA, tenantB, clientA, vehicleA, userA, tokenA, tokenB, createdPhotoId;

  try {
    tenantA = await prisma.tenant.create({ data: { ragioneSociale: `Upload Test A ${suffix}` } });
    tenantB = await prisma.tenant.create({ data: { ragioneSociale: `Upload Test B ${suffix}` } });
    userA = await prisma.user.create({ data: { tenantId: tenantA.id, nome: "A", cognome: "B", email: `upload.a.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    const userB = await prisma.user.create({ data: { tenantId: tenantB.id, nome: "A", cognome: "B", email: `upload.b.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN", emailVerificata: true } });
    clientA = await prisma.client.create({ data: { tenantId: tenantA.id, nome: "Cliente", cognome: "A" } });
    vehicleA = await prisma.vehicle.create({ data: { tenantId: tenantA.id, clientId: clientA.id, marca: "Test", modello: "Test", targa: `UP${suffix}`.slice(0, 8) } });
    tokenA = jwt.sign({ sub: userA.id, tenantId: tenantA.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });
    tokenB = jwt.sign({ sub: userB.id, tenantId: tenantB.id, role: "ADMIN" }, process.env.JWT_SECRET, { expiresIn: "1h" });

    const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=", "base64");

    await t.test("senza token: 401", async () => {
      const form = new FormData();
      form.append("fase", "PRIMA");
      form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "test.jpg");
      const res = await fetch(`${base}/api/vehicles/${vehicleA.id}/photos`, { method: "POST", body: form });
      assert.equal(res.status, 401);
    });

    await t.test("token valido ma veicolo di un altro tenant: 404, non fuga di informazioni", async () => {
      const form = new FormData();
      form.append("fase", "PRIMA");
      form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "test.jpg");
      const res = await fetch(`${base}/api/vehicles/${vehicleA.id}/photos`, { method: "POST", headers: { Authorization: `Bearer ${tokenB}` }, body: form });
      assert.equal(res.status, 404);
    });

    await t.test("file non immagine: rifiutato", async () => {
      const form = new FormData();
      form.append("fase", "PRIMA");
      form.append("file", new Blob([Buffer.from("non sono un'immagine")], { type: "text/plain" }), "test.txt");
      const res = await fetch(`${base}/api/vehicles/${vehicleA.id}/photos`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` }, body: form });
      assert.equal(res.status, 400);
    });

    await t.test("upload valido sul proprio veicolo: riuscito, con URL firmato", async () => {
      const form = new FormData();
      form.append("fase", "PRIMA");
      form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "test.jpg");
      const res = await fetch(`${base}/api/vehicles/${vehicleA.id}/photos`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` }, body: form });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.url, "la foto caricata deve avere un url");
      createdPhotoId = data.id;
    });
  } finally {
    if (createdPhotoId) {
      await fetch(`${base}/api/photos/${createdPhotoId}`, { method: "DELETE", headers: { Authorization: `Bearer ${tokenA}` } }).catch(() => {});
    }
    if (tenantA) {
      await prisma.vehicle.deleteMany({ where: { tenantId: tenantA.id } });
      await prisma.client.deleteMany({ where: { tenantId: tenantA.id } });
      await prisma.user.deleteMany({ where: { tenantId: tenantA.id } });
      await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    }
    if (tenantB) {
      await prisma.user.deleteMany({ where: { tenantId: tenantB.id } });
      await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});
