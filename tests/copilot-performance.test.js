// Punto 25 (performance): margine_veicolo, preventivi_marginalita_bassa e
// disponibilita_tecnici_oggi sono stati riscritti per evitare N+1 (una
// query per veicolo/tecnico dentro un ciclo) con query batch + raggruppamento
// in memoria. Verifica che il risultato resti corretto con dati reali,
// non solo "non lancia errori".

import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import "dotenv/config";

const { prisma } = await import("../src/lib/prisma.js");
const { creaStrumenti } = await import("../src/routes/copilot.js");
const { emptyLedger } = await import("../src/lib/profit.js");

test("Copilot: strumenti senza N+1 restituiscono risultati corretti per veicolo/tecnico", async () => {
  const suffix = Date.now();
  const passwordHash = await bcrypt.hash("Test1234!", 10);
  let tenant, client, v1, v2, tecnico1, tecnico2;

  try {
    tenant = await prisma.tenant.create({ data: { ragioneSociale: `Copilot Perf ${suffix}` } });
    client = await prisma.client.create({ data: { tenantId: tenant.id, nome: "Cliente", cognome: "Test" } });
    v1 = await prisma.vehicle.create({ data: { tenantId: tenant.id, clientId: client.id, marca: "Fiat", modello: "Panda", targa: `CP1${suffix}`.slice(0, 8) } });
    v2 = await prisma.vehicle.create({ data: { tenantId: tenant.id, clientId: client.id, marca: "Fiat", modello: "Punto", targa: `CP2${suffix}`.slice(0, 8) } });

    // Solo v1 ha un Profit Tracker compilato: v2 deve restare "non disponibile".
    const ledger = emptyLedger("2026-09-15");
    ledger.revenue.preventivo = 150000;
    await prisma.profitRecord.create({ data: { tenantId: tenant.id, vehicleId: v1.id, data: ledger, updatedById: "test" } });

    const raccolti = [];
    const strumenti = creaStrumenti(tenant.id, "ADMIN", (r) => raccolti.push(r), "user-test");

    const risultato = await strumenti.margine_veicolo({ ricerca: "Fiat" });
    assert.equal(risultato.length, 2, "deve trovare entrambi i veicoli Fiat");
    const rigaV1 = risultato.find((r) => r.veicolo.includes(v1.targa));
    const rigaV2 = risultato.find((r) => r.veicolo.includes(v2.targa));
    assert.ok(rigaV1.profitTracker, "v1 ha un Profit Tracker: deve avere un margine calcolato");
    assert.equal(rigaV2.profitTracker, null, "v2 senza Profit Tracker: margine non disponibile");

    tecnico1 = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "Uno", email: `cp1.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    tecnico2 = await prisma.user.create({ data: { tenantId: tenant.id, nome: "Tecnico", cognome: "Due", email: `cp2.${suffix}@example.invalid`, passwordHash, ruolo: "TECNICO", emailVerificata: true } });
    const oggi = new Date(); oggi.setHours(10, 0, 0, 0);
    const oggiFine = new Date(); oggiFine.setHours(11, 0, 0, 0);
    await prisma.appointment.create({ data: { tenantId: tenant.id, tecnicoId: tecnico1.id, titolo: "Intervento", inizio: oggi, fine: oggiFine } });

    const strumenti2 = creaStrumenti(tenant.id, "ADMIN", () => {}, "user-test");
    const disponibilita = await strumenti2.disponibilita_tecnici_oggi();
    const riga1 = disponibilita.find((d) => d.tecnico.includes("Uno"));
    const riga2 = disponibilita.find((d) => d.tecnico.includes("Due"));
    assert.equal(riga1.libero, false, "tecnico1 ha un appuntamento oggi: non libero");
    assert.equal(riga1.appuntamentiOggi.length, 1);
    assert.equal(riga2.libero, true, "tecnico2 senza appuntamenti: libero, non deve ereditare quelli di tecnico1");
  } finally {
    if (tenant) {
      await prisma.appointment.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.profitRecord.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.vehicle.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.client.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});
