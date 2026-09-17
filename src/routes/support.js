import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { inviaNotificaTicket } from "../lib/email.js";

export const supportRouter = Router();
supportRouter.use(requireAuth);

const CATEGORIE = ["SUPPORTO", "BUG", "FUNZIONALITA"];
const PRIORITA = ["BASSA", "MEDIA", "ALTA", "URGENTE"];

const creaTicketSchema = z.object({
  categoria: z.enum(CATEGORIE),
  priorita: z.enum(PRIORITA).optional(),
  messaggio: z.string().trim().min(1).max(4000),
});

// POST /api/support/ticket — punto 37 (supporto cliente). Una sola
// entità Ticket per "contatta supporto" / "segnala problema" / "richiedi
// funzione": è la categoria a distinguerli, non tre sistemi paralleli.
supportRouter.post("/ticket", async (req, res) => {
  const parsed = creaTicketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });

  const ticket = await prisma.ticket.create({
    data: {
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      categoria: parsed.data.categoria,
      priorita: parsed.data.priorita || "MEDIA",
      messaggio: parsed.data.messaggio,
    },
    include: { tenant: { select: { ragioneSociale: true } }, user: { select: { nome: true, cognome: true } } },
  });

  inviaNotificaTicket({
    ragioneSociale: ticket.tenant.ragioneSociale,
    categoria: ticket.categoria,
    priorita: ticket.priorita,
    messaggio: ticket.messaggio,
    utente: `${ticket.user.nome} ${ticket.user.cognome}`,
    tenantId: ticket.tenantId,
  }).catch((err) => {
    console.error(`[support] Notifica email fallita per ticket ${ticket.id}:`, err.message);
  });

  res.status(201).json(ticket);
});

// GET /api/support/ticket — i ticket del proprio tenant (visibili a
// tutti i colleghi, non solo a chi li ha aperti: un ADMIN deve poter
// vedere anche quelli aperti da un tecnico, per capire lo stato).
supportRouter.get("/ticket", async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    where: tenantScope(req),
    include: { user: { select: { nome: true, cognome: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(tickets);
});
