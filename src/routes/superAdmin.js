import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireSuperAdmin } from "../middleware/superAdmin.js";
import { loginLimiter } from "../middleware/rateLimit.js";

const STATI_LEAD = ["NUOVO", "CONTATTATO", "DEMO", "TRIAL", "CLIENTE", "PERSO"];
const STATI_TICKET = ["APERTO", "IN_LAVORAZIONE", "RISOLTO", "CHIUSO"];

// Punto 31: rotte di livello piattaforma, separate e parallele a
// /api/auth — mai montate dietro requireAuth/tenantScope (vedi
// middleware/superAdmin.js). Deliberatamente minime: la seed procedure
// e l'autenticazione sono il compito del punto 31; il pannello
// completo è un intervento a sé (vedi SUPER-ADMIN.md). Le due rotte di
// sola lettura qui sotto bastano a dimostrare che il meccanismo
// funziona davvero end-to-end, non solo "si logga e basta".
export const superAdminRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

superAdminRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Credenziali non valide" });
  const { email, password } = parsed.data;

  const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });
  if (!superAdmin || !superAdmin.attivo) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }
  const valido = await bcrypt.compare(password, superAdmin.passwordHash);
  if (!valido) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  await prisma.superAdmin.update({ where: { id: superAdmin.id }, data: { ultimoAccessoAt: new Date() } });

  // Token deliberatamente SENZA tenantId: è ciò che lo distingue da un
  // token utente normale e che middleware/auth.js rifiuta esplicitamente
  // se qualcuno provasse a riusarlo su una rotta tenant-scoped.
  const token = jwt.sign({ sub: superAdmin.id, email: superAdmin.email, superAdmin: true }, process.env.JWT_SECRET, { expiresIn: "4h" });
  res.json({ token, superAdmin: { id: superAdmin.id, email: superAdmin.email } });
});

superAdminRouter.use(requireSuperAdmin);

// GET /api/super-admin/tenants — visibilità su tutte le carrozzerie,
// senza dati operativi (mai clienti/veicoli/preventivi): solo lo stato
// di abbonamento e utilizzo essenziale per la gestione della piattaforma.
superAdminRouter.get("/tenants", async (req, res) => {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true, ragioneSociale: true, piano: true, subscriptionStatus: true,
      isDemo: true, trialEndsAt: true, createdAt: true,
      _count: { select: { users: true, clients: true, vehicles: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(tenants);
});

// GET /api/super-admin/gdpr-richieste — coda delle richieste GDPR in
// attesa su TUTTI i tenant (cancellazione account, ecc.): oggi queste
// richieste vengono solo registrate da ogni tenant (vedi routes/gdpr.js),
// senza nessun modo per un umano di vederle ed elaborarle. Questa è la
// prima rotta che le rende visibili — l'elaborazione vera e propria
// (eseguire la cancellazione) resta un intervento manuale e deliberato,
// non automatizzato da questa rotta.
// Punto 35 (richiesta demo, "Super Admin → LEAD"): pipeline vendita su
// entrambe le origini (punto 34 "contatti" e punto 35 "demo"), stesso
// modello Lead — vedi routes/contatti.js e routes/demo.js. Filtro
// opzionale per stato (?stato=NUOVO), utile quando la lista cresce.
superAdminRouter.get("/leads", async (req, res) => {
  const { stato } = req.query;
  if (stato !== undefined && !STATI_LEAD.includes(stato)) {
    return res.status(400).json({ error: "Stato non valido" });
  }
  const leads = await prisma.lead.findMany({
    where: stato ? { stato } : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(leads);
});

const cambiaStatoSchema = z.object({ stato: z.enum(STATI_LEAD) });

superAdminRouter.patch("/leads/:id/stato", async (req, res) => {
  const parsed = cambiaStatoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Stato non valido" });

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: "Lead non trovato" });

  const aggiornato = await prisma.lead.update({ where: { id: req.params.id }, data: { stato: parsed.data.stato } });
  res.json(aggiornato);
});

// Punto 36 (FAQ modificabile): CRUD completo, riservato al super-admin
// — la pagina pubblica /faq legge solo GET /api/faq (voci attive). Qui
// si vedono anche quelle disattivate, per poterle riattivare.
superAdminRouter.get("/faq", async (req, res) => {
  const faq = await prisma.faqItem.findMany({ orderBy: { ordine: "asc" } });
  res.json(faq);
});

const faqSchema = z.object({
  domanda: z.string().trim().min(1).max(300),
  risposta: z.string().trim().min(1).max(3000),
  ordine: z.number().int().optional(),
  attiva: z.boolean().optional(),
});

superAdminRouter.post("/faq", async (req, res) => {
  const parsed = faqSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const faq = await prisma.faqItem.create({ data: parsed.data });
  res.status(201).json(faq);
});

const faqUpdateSchema = faqSchema.partial();

superAdminRouter.patch("/faq/:id", async (req, res) => {
  const parsed = faqUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const esistente = await prisma.faqItem.findUnique({ where: { id: req.params.id } });
  if (!esistente) return res.status(404).json({ error: "Voce FAQ non trovata" });
  const aggiornata = await prisma.faqItem.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(aggiornata);
});

superAdminRouter.delete("/faq/:id", async (req, res) => {
  const esistente = await prisma.faqItem.findUnique({ where: { id: req.params.id } });
  if (!esistente) return res.status(404).json({ error: "Voce FAQ non trovata" });
  await prisma.faqItem.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Punto 37 (supporto cliente): visibilità su tutti i ticket di tutti i
// tenant, chi li apre non ha modo di vederli gestiti da nessun'altra
// parte oggi (nessun pannello super-admin ancora — vedi SUPER-ADMIN.md).
superAdminRouter.get("/tickets", async (req, res) => {
  const { stato } = req.query;
  if (stato !== undefined && !STATI_TICKET.includes(stato)) {
    return res.status(400).json({ error: "Stato non valido" });
  }
  const tickets = await prisma.ticket.findMany({
    where: stato ? { stato } : undefined,
    include: {
      tenant: { select: { ragioneSociale: true } },
      user: { select: { nome: true, cognome: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(tickets);
});

const cambiaStatoTicketSchema = z.object({ stato: z.enum(STATI_TICKET) });

superAdminRouter.patch("/tickets/:id/stato", async (req, res) => {
  const parsed = cambiaStatoTicketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Stato non valido" });

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket non trovato" });

  const aggiornato = await prisma.ticket.update({ where: { id: req.params.id }, data: { stato: parsed.data.stato } });
  res.json(aggiornato);
});

superAdminRouter.get("/gdpr-richieste", async (req, res) => {
  const richieste = await prisma.gdprRichiesta.findMany({
    where: { stato: "IN_ATTESA" },
    include: {
      tenant: { select: { ragioneSociale: true } },
      richiedente: { select: { nome: true, cognome: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(richieste);
});
