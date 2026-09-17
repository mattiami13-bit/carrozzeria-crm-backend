import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { PIANI, TRIAL_PIANO } from "../lib/billing/piani.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

// GET /api/users
// Restituisce l'elenco degli utenti/tecnici del tenant, senza dati sensibili
// (usato per il selettore "tecnico assegnato" negli appuntamenti e nei veicoli).
usersRouter.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    where: { ...tenantScope(req), attivo: true },
    select: {
      id: true,
      nome: true,
      cognome: true,
      ruolo: true,
    },
    orderBy: { nome: "asc" },
  });
  res.json(users);
});

const createUserSchema = z.object({
  nome: z.string().min(1),
  cognome: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  ruolo: z.enum(["ADMIN", "ACCETTATORE", "TECNICO", "AMMINISTRAZIONE"]).optional(),
});

// POST /api/users
// Crea un nuovo utente (es. tecnico) nel tenant corrente. Solo ADMIN.
usersRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { nome, cognome, email, password, ruolo } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email già registrata" });
  }

  // Stesso limite già applicato al cambio piano (billing.js): il numero di
  // utenti attivi non può superare quelli inclusi nel piano più gli extra
  // acquistati, altrimenti si aggirerebbe il limite creando utenti a piacere.
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  const pianoAttuale = PIANI[tenant.piano === "TRIAL" ? TRIAL_PIANO : tenant.piano];
  const utentiUsati = await prisma.user.count({ where: { tenantId: tenant.id, attivo: true } });
  const utentiInclusi = pianoAttuale.utentiInclusi + tenant.utentiExtra;
  if (utentiUsati >= utentiInclusi) {
    return res.status(409).json({
      error: `Il piano ${pianoAttuale.nome} include ${utentiInclusi} utenti, tutti già attivi. Passa a un piano superiore o acquista utenti extra per aggiungerne altri.`,
      utentiUsati,
      utentiInclusi,
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      tenantId: req.auth.tenantId,
      nome,
      cognome,
      email,
      passwordHash,
      ruolo: ruolo || "TECNICO",
    },
    select: {
      id: true,
      nome: true,
      cognome: true,
      email: true,
      ruolo: true,
    },
  });

  res.status(201).json(user);
});
