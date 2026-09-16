import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { leadFormLimiter } from "../middleware/rateLimit.js";
import { inviaNotificaLeadCommerciale } from "../lib/email.js";

export const demoRouter = Router();

const demoSchema = z.object({
  nome: z.string().trim().min(1).max(100),
  carrozzeria: z.string().trim().min(1).max(150),
  email: z.string().trim().email(),
  telefono: z.string().trim().max(30).optional(),
  numeroDipendenti: z.coerce.number().int().min(0).max(100000).optional(),
  // Honeypot, stessa logica di routes/contatti.js.
  sitoWeb: z.string().optional(),
});

// POST /api/demo — punto 35 (richiesta demo). Stesso modello Lead del
// punto 34 (routes/contatti.js), origine diversa: da qui in poi il
// super-admin (punto 35, "Super Admin → LEAD") vede entrambe insieme e
// fa avanzare lo stato lungo la pipeline di vendita
// (NUOVO→CONTATTATO→DEMO→TRIAL→CLIENTE, o PERSO).
demoRouter.post("/", leadFormLimiter, async (req, res) => {
  const parsed = demoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  }
  const { sitoWeb, ...dati } = parsed.data;
  if (sitoWeb) {
    return res.status(201).json({ ok: true });
  }

  const lead = await prisma.lead.create({
    data: { ...dati, origine: "DEMO" },
  });

  inviaNotificaLeadCommerciale({ ...dati, origine: "DEMO" }).catch((err) => {
    console.error(`[demo] Notifica email fallita per lead ${lead.id}:`, err.message);
  });

  res.status(201).json({ ok: true });
});
