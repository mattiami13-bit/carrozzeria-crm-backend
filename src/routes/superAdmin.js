import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireSuperAdmin } from "../middleware/superAdmin.js";
import { loginLimiter } from "../middleware/rateLimit.js";

const STATI_LEAD = ["NUOVO", "CONTATTATO", "DEMO", "TRIAL", "CLIENTE", "PERSO"];
const STATI_TICKET = ["APERTO", "IN_LAVORAZIONE", "RISOLTO", "CHIUSO"];
const PIANI_VALIDI = ["TRIAL", "STARTER", "PRO", "PREMIUM_AI"];

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

// Punto 38 (changelog): CRUD completo, riservato al super-admin — la
// tabella nasce vuota (nessuno storico inventato) e cresce solo quando
// qualcosa spedisce davvero. Stesso pattern del CRUD FAQ sopra.
superAdminRouter.get("/changelog", async (req, res) => {
  const voci = await prisma.changelogEntry.findMany({ orderBy: { data: "desc" } });
  res.json(voci);
});

const changelogSchema = z.object({
  titolo: z.string().trim().min(1).max(200),
  descrizione: z.string().trim().min(1).max(3000),
  data: z.coerce.date().optional(),
});

superAdminRouter.post("/changelog", async (req, res) => {
  const parsed = changelogSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const voce = await prisma.changelogEntry.create({ data: parsed.data });
  res.status(201).json(voce);
});

const changelogUpdateSchema = changelogSchema.partial();

superAdminRouter.patch("/changelog/:id", async (req, res) => {
  const parsed = changelogUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const esistente = await prisma.changelogEntry.findUnique({ where: { id: req.params.id } });
  if (!esistente) return res.status(404).json({ error: "Voce non trovata" });
  const aggiornata = await prisma.changelogEntry.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(aggiornata);
});

superAdminRouter.delete("/changelog/:id", async (req, res) => {
  const esistente = await prisma.changelogEntry.findUnique({ where: { id: req.params.id } });
  if (!esistente) return res.status(404).json({ error: "Voce non trovata" });
  await prisma.changelogEntry.delete({ where: { id: req.params.id } });
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

// Punto 39 (feature flag centralizzate): CRUD del flag stesso più la
// gestione degli override per singolo tenant — vedi il commento sul
// modello FeatureFlag in schema.prisma per i 4 livelli di attivazione
// e lib/featureFlags.js per come vengono valutati.
superAdminRouter.get("/feature-flags", async (req, res) => {
  const flags = await prisma.featureFlag.findMany({
    include: { overrideTenant: { include: { tenant: { select: { ragioneSociale: true } } } } },
    orderBy: { chiave: "asc" },
  });
  res.json(flags);
});

const featureFlagSchema = z.object({
  chiave: z.string().trim().min(1).max(100).regex(/^[a-z0-9_]+$/, "Usa solo lettere minuscole, numeri e underscore"),
  descrizione: z.string().trim().max(500).optional(),
  abilitataGlobalmente: z.boolean().optional(),
  piani: z.array(z.enum(PIANI_VALIDI)).optional(),
  ambienti: z.array(z.string().trim().min(1)).optional(),
});

superAdminRouter.post("/feature-flags", async (req, res) => {
  const parsed = featureFlagSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const esistente = await prisma.featureFlag.findUnique({ where: { chiave: parsed.data.chiave } });
  if (esistente) return res.status(409).json({ error: "Esiste già un flag con questa chiave" });
  const flag = await prisma.featureFlag.create({ data: parsed.data });
  res.status(201).json(flag);
});

const featureFlagUpdateSchema = featureFlagSchema.omit({ chiave: true }).partial();

superAdminRouter.patch("/feature-flags/:id", async (req, res) => {
  const parsed = featureFlagUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const esistente = await prisma.featureFlag.findUnique({ where: { id: req.params.id } });
  if (!esistente) return res.status(404).json({ error: "Flag non trovato" });
  const aggiornato = await prisma.featureFlag.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(aggiornato);
});

superAdminRouter.delete("/feature-flags/:id", async (req, res) => {
  const esistente = await prisma.featureFlag.findUnique({ where: { id: req.params.id } });
  if (!esistente) return res.status(404).json({ error: "Flag non trovato" });
  await prisma.featureFlag.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

const overrideSchema = z.object({ tenantId: z.string().min(1), abilitata: z.boolean() });

superAdminRouter.put("/feature-flags/:id/override", async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  const flag = await prisma.featureFlag.findUnique({ where: { id: req.params.id } });
  if (!flag) return res.status(404).json({ error: "Flag non trovato" });
  const tenant = await prisma.tenant.findUnique({ where: { id: parsed.data.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant non trovato" });

  const override = await prisma.featureFlagTenantOverride.upsert({
    where: { featureFlagId_tenantId: { featureFlagId: flag.id, tenantId: parsed.data.tenantId } },
    create: { featureFlagId: flag.id, tenantId: parsed.data.tenantId, abilitata: parsed.data.abilitata },
    update: { abilitata: parsed.data.abilitata },
  });
  res.json(override);
});

superAdminRouter.delete("/feature-flags/:id/override/:tenantId", async (req, res) => {
  const esistente = await prisma.featureFlagTenantOverride.findUnique({
    where: { featureFlagId_tenantId: { featureFlagId: req.params.id, tenantId: req.params.tenantId } },
  });
  if (!esistente) return res.status(404).json({ error: "Override non trovato" });
  await prisma.featureFlagTenantOverride.delete({ where: { id: esistente.id } });
  res.status(204).end();
});
