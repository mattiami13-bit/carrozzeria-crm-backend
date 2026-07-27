import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const authRouter = Router();

const registerSchema = z.object({
  ragioneSociale: z.string().min(2),
  partitaIva: z.string().optional(),
  nomeAdmin: z.string().min(1),
  cognomeAdmin: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// Crea un nuovo tenant (carrozzeria) con il suo utente ADMIN e avvia
// automaticamente la prova gratuita di 30 giorni.
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { ragioneSociale, partitaIva, nomeAdmin, cognomeAdmin, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email già registrata" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const tenant = await prisma.tenant.create({
    data: {
      ragioneSociale,
      partitaIva,
      trialEndsAt,
      users: {
        create: {
          nome: nomeAdmin,
          cognome: cognomeAdmin,
          email,
          passwordHash,
          ruolo: "ADMIN",
        },
      },
    },
    include: { users: true },
  });

  const admin = tenant.users[0];
  const token = signToken(admin, tenant.id);
  res.status(201).json({ token, tenant: { id: tenant.id, ragioneSociale: tenant.ragioneSociale } });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.attivo) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  const token = signToken(user, user.tenantId);
  res.json({
    token,
    user: { id: user.id, nome: user.nome, cognome: user.cognome, ruolo: user.ruolo },
  });
});

function signToken(user, tenantId) {
  return jwt.sign(
    { sub: user.id, tenantId, role: user.ruolo },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h" }
  );
}
