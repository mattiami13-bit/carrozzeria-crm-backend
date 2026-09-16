// Punto 28 (dati demo): verifica che lo script di seed si rifiuti di
// scrivere su un tenant che esiste già con lo stesso nome ma senza
// isDemo=true — la barriera di sicurezza contro "dati demo in un tenant
// reale" deve reggere, non solo in teoria.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";

const run = promisify(execFile);
const { prisma } = await import("../src/lib/prisma.js");

test("Seed demo: si rifiuta di toccare un tenant omonimo senza isDemo=true", async () => {
  const nomeIsolato = `Rifless Demo Test ${Date.now()}`;
  const finto = await prisma.tenant.create({ data: { ragioneSociale: nomeIsolato } });
  try {
    await assert.rejects(
      run("node", ["scripts/seed-demo-tenant.mjs"], { cwd: process.cwd(), env: { ...process.env, DEMO_TENANT_NAME: nomeIsolato } }),
      /isDemo/
    );
    // Nessuna scrittura deve essere avvenuta sul tenant finto.
    const invariato = await prisma.tenant.findUnique({ where: { id: finto.id } });
    assert.equal(invariato.isDemo, false);
    const veicoli = await prisma.vehicle.count({ where: { tenantId: finto.id } });
    assert.equal(veicoli, 0);
  } finally {
    await prisma.tenant.delete({ where: { id: finto.id } }).catch(() => {});
  }
});
