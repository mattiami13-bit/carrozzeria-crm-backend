// TEST FONDAMENTALE (obbligatorio): due tenant reali, dati reali creati e
// ripuliti a fine test, verificati attraverso l'app HTTP vera (stessi
// router montati da src/index.js), non attraverso mock. Dimostra che un
// utente del Tenant A non può leggere, scaricare o modificare nessuna
// risorsa del Tenant B tramite API — inclusi file binari (documenti/
// fotografie) — usando solo il proprio JWT valido.
//
// Il Copilot AI non è testato dal vivo qui (richiede ANTHROPIC_API_KEY,
// presente solo nell'ambiente Railway, non in locale): la sua sicurezza
// tenant è verificata per ispezione del codice in questo stesso file
// (vedi test dedicato), perché ogni query che esegue è scopata sul
// tenantId ricavato server-side dal JWT, mai da un parametro del client.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-tenant-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { clientsRouter } = await import("../src/routes/clients.js");
const { vehiclesRouter } = await import("../src/routes/vehicles.js");
const { quotesRouter } = await import("../src/routes/quotes.js");
const { usersRouter } = await import("../src/routes/users.js");
const { vehicleQcRouter, qcInspectionRouter } = await import("../src/routes/qc.js");
const { vehicleWorkOrdersRouter, workOrdersRouter } = await import("../src/routes/workOrders.js");
const { loanerCarsRouter } = await import("../src/routes/loanerCars.js");
const { insuranceGapRouter } = await import("../src/routes/insuranceGap.js");
const { liveDashboardRouter } = await import("../src/routes/liveDashboard.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/clients", clientsRouter);
  app.use("/api/vehicles", vehiclesRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/vehicles/:vehicleId/qc", vehicleQcRouter);
  app.use("/api/qc/inspections", qcInspectionRouter);
  app.use("/api/vehicles/:vehicleId/work-orders", vehicleWorkOrdersRouter);
  app.use("/api/work-orders", workOrdersRouter);
  app.use("/api/loaner-cars", loanerCarsRouter);
  app.use("/api/vehicles/:vehicleId/insurance-gap", insuranceGapRouter);
  app.use("/api/live-dashboard", liveDashboardRouter);
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

function tokenFor(user, tenantId) {
  return jwt.sign({ sub: user.id, tenantId, role: user.ruolo }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

test("Isolamento tenant: Tenant A e Tenant B non possono raggiungersi a vicenda via API", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout: nessuna risposta da ${init.method || "GET"} ${path} entro 8s`)), 8000);
    return fetch(`${base}${path}`, { ...init, signal: controller.signal, headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).finally(() => clearTimeout(timer));
  };

  const suffix = Date.now();
  const created = { tenants: [], users: [] };
  let A, B, userA, userB, tokenA, tokenB, clientA, vehicleA, quoteA, checklistA, inspectionA, workOrderA, loanerCarA, gapAnalysisA;

  try {
    // --- Setup: due tenant reali, dati reali per il Tenant A ---
    A = await prisma.tenant.create({ data: { ragioneSociale: `Isolamento Test A ${suffix}` } });
    B = await prisma.tenant.create({ data: { ragioneSociale: `Isolamento Test B ${suffix}` } });
    created.tenants.push(A.id, B.id);

    const passwordHash = await bcrypt.hash("Test1234!Isolamento", 10);
    userA = await prisma.user.create({ data: { tenantId: A.id, nome: "Admin", cognome: "A", email: `isolamento.a.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN" } });
    userB = await prisma.user.create({ data: { tenantId: B.id, nome: "Admin", cognome: "B", email: `isolamento.b.${suffix}@example.invalid`, passwordHash, ruolo: "ADMIN" } });
    tokenA = tokenFor(userA, A.id);
    tokenB = tokenFor(userB, B.id);

    clientA = await prisma.client.create({ data: { tenantId: A.id, nome: "Cliente", cognome: "Riservato A", telefono: "3331112222" } });
    vehicleA = await prisma.vehicle.create({ data: { tenantId: A.id, clientId: clientA.id, marca: "Segreto", modello: "TenantA", targa: `ISOL${suffix}` } });
    quoteA = await prisma.quote.create({ data: { tenantId: A.id, clientId: clientA.id, vehicleId: vehicleA.id, imponibile: "100", totale: "122", items: { create: [{ tipo: "MANODOPERA", descrizione: "Riservato", quantita: 1, prezzoUnitario: 100 }] } } });
    checklistA = await prisma.qcChecklistItem.create({ data: { tenantId: A.id, chiave: `riservato_${suffix}`, etichetta: "Voce riservata A", ordine: 0, critico: false } });
    inspectionA = await prisma.qcInspection.create({ data: { tenantId: A.id, vehicleId: vehicleA.id } });
    workOrderA = await prisma.workOrder.create({ data: { tenantId: A.id, vehicleId: vehicleA.id, tecnicoId: userA.id, titolo: "Lavorazione riservata A", reparto: "CARROZZERIA", oreStimate: 1 } });
    loanerCarA = await prisma.loanerCar.create({ data: { tenantId: A.id, targa: `LOAN${suffix}`, marca: "Riservata", modello: "A" } });
    gapAnalysisA = await prisma.insuranceGapAnalysis.create({ data: { tenantId: A.id, vehicleId: vehicleA.id, quoteId: quoteA.id, documentName: "riservato.pdf", documentMime: "application/pdf", documentSize: 4, documentContent: Buffer.from("test"), totalePreventivoInterno: 100 } });

    // --- Sanity: il Tenant A raggiunge davvero le proprie risorse (altrimenti i 404 sotto non proverebbero nulla) ---
    assert.equal((await call(`/api/clients/${clientA.id}`, tokenA)).status, 200, "A deve vedere il proprio cliente");
    assert.equal((await call(`/api/vehicles/${vehicleA.id}`, tokenA)).status, 200, "A deve vedere il proprio veicolo");

    // --- Il Tenant B NON deve raggiungere nessuna risorsa del Tenant A ---
    const tentativiIncrociati = [
      ["GET", `/api/clients/${clientA.id}`, "cliente A"],
      ["PATCH", `/api/clients/${clientA.id}`, "modifica cliente A", { note: "hack" }],
      ["GET", `/api/vehicles/${vehicleA.id}`, "veicolo A"],
      ["PATCH", `/api/vehicles/${vehicleA.id}/stage`, "cambio stato veicolo A", { stage: "PRONTA_CONSEGNA" }],
      ["GET", `/api/quotes`, "elenco preventivi (non deve includere A)", null, "list"],
      ["GET", `/api/vehicles/${vehicleA.id}/qc`, "QC del veicolo A"],
      ["POST", `/api/vehicles/${vehicleA.id}/qc`, "avvio QC su veicolo A"],
      ["GET", `/api/qc/inspections/${inspectionA.id}`, "ispezione QC A"],
      ["PATCH", `/api/qc/inspections/${inspectionA.id}/esiti/${checklistA.chiave}`, "esito QC A", { esito: "OK" }],
      ["GET", `/api/vehicles/${vehicleA.id}/work-orders`, "lavorazioni veicolo A"],
      ["POST", `/api/work-orders/${workOrderA.id}/inizia`, "avvio lavorazione A"],
      ["GET", `/api/loaner-cars/${loanerCarA.id}`, "auto sostitutiva A"],
      ["DELETE", `/api/loaner-cars/${loanerCarA.id}`, "eliminazione auto sostitutiva A"],
      ["GET", `/api/vehicles/${vehicleA.id}/insurance-gap`, "analisi assicurazione A"],
      ["GET", `/api/vehicles/${vehicleA.id}/insurance-gap/${gapAnalysisA.id}/documento`, "download documento assicurazione A (file binario)"],
    ];

    for (const [method, path, label, body, mode] of tentativiIncrociati) {
      const res = await call(path, tokenB, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      if (mode === "list") {
        assert.equal(res.status, 200, `${label}: la route deve rispondere (è una lista)`);
        const data = await res.json();
        const ids = JSON.stringify(data);
        assert.ok(!ids.includes(quoteA.id), `${label}: l'id del preventivo di A non deve comparire nella lista di B`);
      } else {
        assert.ok([403, 404].includes(res.status), `${label}: B ha ottenuto ${res.status} invece di 403/404 — possibile fuga cross-tenant`);
      }
    }

    // --- Nessun accesso senza token, su nessuna delle route sopra ---
    for (const [method, path] of tentativiIncrociati) {
      const res = await call(path, null, { method });
      assert.equal(res.status, 401, `${path} senza token deve rispondere 401`);
    }

    // --- Manipolazione diretta del tenant_id: un JWT valido per B non deve
    // poter dichiarare di essere A modificando solo l'id nel body/route ---
    const resFinto = await call(`/api/vehicles`, tokenB, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: clientA.id, marca: "X", modello: "Y", targa: "HACK" }) });
    assert.ok([400, 404].includes(resFinto.status), "B non deve poter creare un veicolo agganciato a un cliente di A");
  } finally {
    // --- Pulizia: nessun dato transitorio deve restare nel database reale ---
    // (include l'eventuale veicolo creato dal tentativo di IDOR sul clientId)
    await prisma.stageHistory.deleteMany({ where: { vehicle: { tenantId: { in: created.tenants } } } });
    await prisma.insuranceGapAnalysis.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.workOrderEvento.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.workOrderTimeEntry.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.workOrder.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.qcCheckResult.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.qcEvento.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.qcInspection.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.qcChecklistItem.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.loanerCar.deleteMany({ where: { tenantId: { in: created.tenants } } });
    if (quoteA) await prisma.quoteItem.deleteMany({ where: { quoteId: quoteA.id } });
    await prisma.quote.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.vehicle.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.client.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: created.tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }
});

test("Copilot AI: ogni query è scopata sul tenantId ricavato server-side dal JWT (verifica statica, il Copilot richiede ANTHROPIC_API_KEY non disponibile in locale)", () => {
  const src = fs.readFileSync(new URL("../src/routes/copilot.js", import.meta.url), "utf-8");
  // Il tenantId usato da ogni strumento deve provenire da tenantScope(req)
  // (server-side), non da un parametro passato dal modello/dal client.
  assert.ok(src.includes("tenantScope(req)"), "copilot.js deve ricavare il tenant da tenantScope(req)");
  assert.ok(src.includes("creaStrumenti(tenantId"), "gli strumenti del Copilot devono ricevere il tenantId per closure, non come parametro del tool");
  // Nessuna query del Copilot deve costruire un "where" senza tenantId.
  const whereBlocks = src.match(/where:\s*\{[^}]*\}/g) || [];
  const senzaTenant = whereBlocks.filter((w) => !w.includes("tenantId") && !w.includes("tenant:"));
  assert.equal(senzaTenant.length, 0, `Query Copilot senza tenantId nel where: ${JSON.stringify(senzaTenant)}`);
});
