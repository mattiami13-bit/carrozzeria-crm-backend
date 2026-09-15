import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { creaNotificaRuoli } from "../lib/notificheInApp.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

// GET /api/clients?search=rossi  → ricerca intelligente per nome, telefono, email
clientsRouter.get("/", async (req, res) => {
  const { search } = req.query;
  const clients = await prisma.client.findMany({
    where: {
      ...tenantScope(req),
      ...(search
        ? {
            OR: [
              { nome: { contains: String(search), mode: "insensitive" } },
              { cognome: { contains: String(search), mode: "insensitive" } },
              { telefono: { contains: String(search) } },
              { email: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { vehicles: true } } },
  });
  res.json(clients);
});

clientsRouter.get("/:id", async (req, res) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      vehicles: { orderBy: { dataIngresso: "desc" } },
      quotes: { orderBy: { createdAt: "desc" } },
      documents: true,
    },
  });
  if (!client) return res.status(404).json({ error: "Cliente non trovato" });
  res.json(client);
});

const clientSchema = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  telefono: z.string().optional(),
  email: z.string().email().optional(),
  codiceFiscale: z.string().optional(),
  partitaIva: z.string().optional(),
  indirizzo: z.string().optional(),
  noteInterne: z.string().optional(),
  notificheWhatsappConsenso: z.boolean().optional(),
  notificheWhatsappAttive: z.boolean().optional(),
});

clientsRouter.post("/", async (req, res) => {
  const parsed = clientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.create({
    data: { ...parsed.data, ...tenantScope(req) },
  });

  creaNotificaRuoli({
    tenantId: client.tenantId,
    ruoli: ["ADMIN", "AMMINISTRAZIONE"],
    categoria: "CLIENTI",
    titolo: "Nuovo cliente registrato",
    messaggio: `${client.nome} ${client.cognome} è stato aggiunto all'anagrafica clienti.`,
    link: { tab: "clienti" },
    escludiUserId: req.auth.userId,
  }).catch((err) => console.error("[notifiche] Errore creazione notifica nuovo cliente:", err.message));

  res.status(201).json(client);
});

clientsRouter.patch("/:id", async (req, res) => {
  const parsed = clientSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Il consenso privacy WhatsApp va sempre datato: registriamo il momento
  // in cui viene esplicitamente attivato, per poterlo dimostrare.
  const data = { ...parsed.data };
  if (data.notificheWhatsappConsenso === true) data.notificheWhatsappConsensoAt = new Date();
  if (data.notificheWhatsappConsenso === false) data.notificheWhatsappConsensoAt = null;

  const { count } = await prisma.client.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data,
  });
  if (count === 0) return res.status(404).json({ error: "Cliente non trovato" });

  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  res.json(client);
});

// GET /api/clients/:id/export — diritto alla portabilità dei dati (GDPR):
// tutto ciò che il gestionale sa su QUESTO cliente specifico, in un unico
// file scaricabile. Non include foto/documenti binari inline, solo i
// loro metadati.
clientsRouter.get("/:id/export", requireRole("ADMIN", "AMMINISTRAZIONE"), async (req, res) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      vehicles: true,
      quotes: { include: { items: true } },
      documents: { select: { id: true, nome: true, createdAt: true } },
      appointments: true,
      sinistri: true,
      loanerBookings: true,
    },
  });
  if (!client) return res.status(404).json({ error: "Cliente non trovato" });

  const export_ = {
    generatoIl: new Date().toISOString(),
    cliente: client,
    nota: "Export dei dati personali di questo cliente ai sensi del diritto alla portabilità (GDPR art. 20). Foto e documenti binari non sono inclusi inline, solo i loro metadati.",
  };

  await prisma.gdprRichiesta.create({
    data: { tenantId: client.tenantId, tipo: "EXPORT_DATI", stato: "COMPLETATA", richiedenteId: req.auth.userId, clienteId: client.id, risoltoAt: new Date() },
  });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="export-cliente-${client.id.slice(-6)}.json"`);
  res.json(export_);
});

// POST /api/clients/:id/richiesta-cancellazione — anonimizza (non
// cancella) i dati identificativi del cliente: veicoli/preventivi/
// sinistri collegati restano intatti per obblighi contabili e di
// garanzia, ma non sono più riconducibili a una persona identificabile.
clientsRouter.post("/:id/richiesta-cancellazione", requireRole("ADMIN"), async (req, res) => {
  const client = await prisma.client.findFirst({ where: { id: req.params.id, ...tenantScope(req) } });
  if (!client) return res.status(404).json({ error: "Cliente non trovato" });
  if (client.datiAnonimizzati) return res.json({ ok: true, giaAnonimizzato: true });

  const anonimizzatoAt = new Date();
  const anonimizzato = await prisma.client.update({
    where: { id: client.id },
    data: {
      nome: "Cliente",
      cognome: "rimosso su richiesta GDPR",
      telefono: null,
      email: null,
      codiceFiscale: null,
      partitaIva: null,
      indirizzo: null,
      noteInterne: null,
      notificheWhatsappConsenso: false,
      notificheWhatsappConsensoAt: null,
      notificheWhatsappAttive: false,
      datiAnonimizzati: true,
      anonimizzatoAt,
    },
  });

  await prisma.gdprRichiesta.create({
    data: { tenantId: client.tenantId, tipo: "CANCELLAZIONE_CLIENTE", stato: "COMPLETATA", richiedenteId: req.auth.userId, clienteId: client.id, risoltoAt: anonimizzatoAt },
  });

  res.json({ ok: true, cliente: anonimizzato });
});
