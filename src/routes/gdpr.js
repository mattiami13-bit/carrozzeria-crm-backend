import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { creaNotificaRuoli } from "../lib/notificheInApp.js";

export const gdprRouter = Router();
gdprRouter.use(requireAuth);

// GET /api/gdpr/export — esportazione dei dati operativi del tenant
// (punto 18/43 del prompt SaaS). Riservata ad ADMIN: contiene dati di
// tutti i clienti, non solo di chi la richiede. Nessun contenuto binario
// (foto/documenti) è incluso inline: solo i loro metadati, per non far
// esplodere le dimensioni dell'export e non duplicare storage sensibile.
gdprRouter.get("/export", requireRole("ADMIN"), async (req, res) => {
  const scope = tenantScope(req);

  const [tenant, users, clients, vehicles, quotes, sinistri, appointments, loanerCars] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: req.auth.tenantId } }),
    prisma.user.findMany({
      where: scope,
      select: { id: true, nome: true, cognome: true, email: true, ruolo: true, attivo: true, createdAt: true },
    }),
    prisma.client.findMany({
      where: scope,
      include: { documents: { select: { id: true, nome: true, createdAt: true } } },
    }),
    prisma.vehicle.findMany({ where: scope, select: { id: true, clientId: true, marca: true, modello: true, targa: true, vin: true, colore: true, dataIngresso: true, stage: true } }),
    prisma.quote.findMany({ where: scope, select: { id: true, clientId: true, vehicleId: true, stato: true, imponibile: true, aliquotaIva: true, totale: true, createdAt: true } }),
    prisma.sinistro.findMany({ where: scope, select: { id: true, clientId: true, vehicleId: true, numeroPratica: true, compagniaAssicurativa: true, stato: true, createdAt: true } }),
    prisma.appointment.findMany({ where: scope, select: { id: true, clientId: true, vehicleId: true, titolo: true, inizio: true, fine: true, tipo: true } }),
    prisma.loanerCar.findMany({ where: scope, select: { id: true, targa: true, marca: true, modello: true } }),
  ]);

  const export_ = {
    generatoIl: new Date().toISOString(),
    tenant: tenant ? { id: tenant.id, ragioneSociale: tenant.ragioneSociale, partitaIva: tenant.partitaIva, createdAt: tenant.createdAt } : null,
    utenti: users,
    clienti: clients,
    veicoli: vehicles,
    preventivi: quotes,
    sinistri,
    appuntamenti: appointments,
    autoSostitutive: loanerCars,
    nota: "Export dei dati operativi principali. Foto e documenti binari non sono inclusi inline (solo i loro metadati): sono disponibili tramite le rispettive route autenticate del gestionale.",
  };

  const richiesta = await prisma.gdprRichiesta.create({
    data: { tenantId: req.auth.tenantId, tipo: "EXPORT_DATI", stato: "COMPLETATA", richiedenteId: req.auth.userId, risoltoAt: new Date() },
  });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="export-dati-${req.auth.tenantId}-${richiesta.id.slice(-6)}.json"`);
  res.json(export_);
});

// POST /api/gdpr/richiesta-cancellazione-account — NON cancella nulla
// automaticamente: registra la richiesta e avvisa gli altri ADMIN. La
// cancellazione reale di un intero tenant (con tutti i suoi dati
// operativi) richiede una procedura con controllo umano, che oggi non
// esiste ancora (serve il pannello super-admin del punto 13).
gdprRouter.post("/richiesta-cancellazione-account", requireRole("ADMIN"), async (req, res) => {
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : null;

  const richiesta = await prisma.gdprRichiesta.create({
    data: { tenantId: req.auth.tenantId, tipo: "CANCELLAZIONE_ACCOUNT", richiedenteId: req.auth.userId, note },
  });

  creaNotificaRuoli({
    tenantId: req.auth.tenantId,
    ruoli: ["ADMIN"],
    categoria: "SICUREZZA",
    titolo: "Richiesta di cancellazione account",
    messaggio: "È stata registrata una richiesta di cancellazione dell'organizzazione. Verrà elaborata manualmente: nessun dato è stato ancora eliminato.",
  }).catch((err) => console.error("[gdpr] Errore creazione notifica richiesta cancellazione:", err.message));

  res.status(201).json({
    ok: true,
    richiesta,
    messaggio: "Richiesta registrata. Verrà elaborata manualmente: i tuoi dati non sono stati ancora eliminati.",
  });
});

gdprRouter.get("/richieste", requireRole("ADMIN"), async (req, res) => {
  const richieste = await prisma.gdprRichiesta.findMany({
    where: tenantScope(req),
    orderBy: { createdAt: "desc" },
    include: { richiedente: { select: { nome: true, cognome: true } } },
  });
  res.json(richieste);
});
