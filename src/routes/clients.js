import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
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
