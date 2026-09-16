// Punto 28 del prompt SaaS ("dati demo"): crea (o azzera e ricrea con
// --reset) UN tenant demo separato, mai dentro un tenant reale.
//
// Uso:
//   node scripts/seed-demo-tenant.mjs           crea il tenant demo se non esiste già
//   node scripts/seed-demo-tenant.mjs --reset   svuota i dati operativi del tenant demo e li riseeda
//
// Sicurezza: prima di QUALUNQUE scrittura o cancellazione, lo script
// verifica che il tenant target abbia isDemo=true nel database. Se un
// tenant con lo stesso nome esistesse per errore senza quel flag, lo
// script si rifiuta di toccarlo — non basta "sembrare" il tenant demo.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

// Configurabile via env solo per isolare i test dal vero tenant demo
// (vedi tests/demo-seed.test.js) — in uso normale è sempre "Rifless Demo".
const RAGIONE_SOCIALE_DEMO = process.env.DEMO_TENANT_NAME || "Rifless Demo";
const EMAIL_ADMIN_DEMO = "demo@rifless.it";
const PASSWORD_ADMIN_DEMO = "RiflessDemo2026!";

const reset = process.argv.includes("--reset");

async function trovaOCreaTenantDemo() {
  let tenant = await prisma.tenant.findFirst({ where: { ragioneSociale: RAGIONE_SOCIALE_DEMO } });

  if (tenant && !tenant.isDemo) {
    throw new Error(
      `Esiste già un tenant "${RAGIONE_SOCIALE_DEMO}" (id ${tenant.id}) ma NON ha isDemo=true. ` +
      `Per sicurezza lo script si ferma qui: non scrive mai su un tenant che non sia esplicitamente demo.`
    );
  }

  if (tenant) return tenant;

  const passwordHash = await bcrypt.hash(PASSWORD_ADMIN_DEMO, 12);
  tenant = await prisma.tenant.create({
    data: {
      ragioneSociale: RAGIONE_SOCIALE_DEMO,
      isDemo: true,
      piano: "PRO",
      subscriptionStatus: "ACTIVE",
      users: {
        create: {
          nome: "Demo",
          cognome: "Admin",
          email: EMAIL_ADMIN_DEMO,
          passwordHash,
          ruolo: "ADMIN",
          emailVerificata: true,
        },
      },
    },
  });
  console.log(`Tenant demo creato: ${tenant.id}`);
  console.log(`Login demo: ${EMAIL_ADMIN_DEMO} / ${PASSWORD_ADMIN_DEMO}`);
  return tenant;
}

async function svuotaDatiOperativi(tenantId) {
  // Verifica di sicurezza ripetuta anche qui, non solo a monte: una
  // funzione che cancella dati non deve mai fidarsi solo di chi la chiama.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.isDemo) throw new Error(`Rifiuto di svuotare il tenant ${tenantId}: isDemo non è true.`);

  const vehicles = await prisma.vehicle.findMany({ where: { tenantId }, select: { id: true } });
  const vIds = vehicles.map((v) => v.id);
  await prisma.stageHistory.deleteMany({ where: { vehicleId: { in: vIds } } });
  await prisma.quoteItem.deleteMany({ where: { quote: { tenantId } } });
  await prisma.quote.deleteMany({ where: { tenantId } });
  await prisma.appointment.deleteMany({ where: { tenantId } });
  await prisma.vehicle.deleteMany({ where: { tenantId } });
  await prisma.client.deleteMany({ where: { tenantId } });
  console.log("Dati operativi del tenant demo svuotati.");
}

const CLIENTI_DEMO = [
  { nome: "Marco", cognome: "Bianchi", telefono: "3331112233", email: "marco.bianchi@example-demo.it" },
  { nome: "Giulia", cognome: "Ferrari", telefono: "3339998877", email: "giulia.ferrari@example-demo.it" },
  { nome: "Luca", cognome: "Romano", telefono: "3345671234", email: "luca.romano@example-demo.it" },
  { nome: "Sara", cognome: "Colombo", telefono: "3357654321", email: "sara.colombo@example-demo.it" },
  { nome: "Davide", cognome: "Ricci", telefono: "3369876543", email: "davide.ricci@example-demo.it" },
];

const VEICOLI_DEMO = [
  { marca: "Fiat", modello: "Panda", targa: "AA111BB", stage: "ACCETTAZIONE" },
  { marca: "Volkswagen", modello: "Golf", targa: "BB222CC", stage: "PREVENTIVO" },
  { marca: "Renault", modello: "Clio", targa: "CC333DD", stage: "ORDINE_RICAMBI" },
  { marca: "Fiat", modello: "500", targa: "DD444EE", stage: "IN_LAVORAZIONE" },
  { marca: "Toyota", modello: "Yaris", targa: "EE555FF", stage: "VERNICIATURA" },
  { marca: "Opel", modello: "Corsa", targa: "FF666GG", stage: "PRONTA_CONSEGNA" },
];

async function seedDatiOperativi(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.isDemo) throw new Error(`Rifiuto di scrivere dati demo sul tenant ${tenantId}: isDemo non è true.`);

  const admin = await prisma.user.findFirst({ where: { tenantId, ruolo: "ADMIN" } });

  const clienti = [];
  for (const c of CLIENTI_DEMO) {
    clienti.push(await prisma.client.create({ data: { tenantId, ...c } }));
  }

  for (let i = 0; i < VEICOLI_DEMO.length; i++) {
    const v = VEICOLI_DEMO[i];
    const cliente = clienti[i % clienti.length];
    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId,
        clientId: cliente.id,
        marca: v.marca,
        modello: v.modello,
        targa: v.targa,
        stage: v.stage,
        dataIngresso: new Date(Date.now() - (VEICOLI_DEMO.length - i) * 2 * 24 * 60 * 60 * 1000),
        dataPrevistaConsegna: new Date(Date.now() + (i + 1) * 2 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.stageHistory.create({
      data: { vehicleId: vehicle.id, toStage: v.stage, changedById: admin?.id ?? null },
    });

    // Un paio di preventivi di esempio, solo per le pratiche già oltre l'accettazione.
    if (v.stage !== "ACCETTAZIONE") {
      await prisma.quote.create({
        data: {
          tenantId,
          clientId: cliente.id,
          vehicleId: vehicle.id,
          stato: "INVIATO",
          imponibile: 500,
          aliquotaIva: 22,
          totale: 610,
          items: {
            create: [
              { tipo: "MANODOPERA", descrizione: "Riparazione carrozzeria (dati di esempio)", quantita: 8, prezzoUnitario: 45 },
              { tipo: "VERNICE", descrizione: "Verniciatura pannello (dati di esempio)", quantita: 1, prezzoUnitario: 140 },
            ],
          },
        },
      });
    }
  }

  console.log(`Seed completato: ${clienti.length} clienti, ${VEICOLI_DEMO.length} veicoli demo.`);
}

async function main() {
  const tenant = await trovaOCreaTenantDemo();
  if (reset) {
    await svuotaDatiOperativi(tenant.id);
    await seedDatiOperativi(tenant.id);
  } else {
    const esistenti = await prisma.vehicle.count({ where: { tenantId: tenant.id } });
    if (esistenti === 0) {
      await seedDatiOperativi(tenant.id);
    } else {
      console.log(`Il tenant demo ha già ${esistenti} veicoli: nessuna azione (usa --reset per riseedare).`);
    }
  }
  console.log(`\nTenant demo pronto: id=${tenant.id}, login=${EMAIL_ADMIN_DEMO}`);
}

main()
  .catch((err) => {
    console.error("Errore:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
