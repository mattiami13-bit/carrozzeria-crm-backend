import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { leadFormLimiter } from "../middleware/rateLimit.js";
import { inviaNotificaLeadCommerciale } from "../lib/email.js";

export const contattiRouter = Router();

const contattiSchema = z.object({
  nome: z.string().trim().min(1).max(100),
  cognome: z.string().trim().max(100).optional(),
  carrozzeria: z.string().trim().min(1).max(150),
  email: z.string().trim().email(),
  telefono: z.string().trim().max(30).optional(),
  numeroDipendenti: z.coerce.number().int().min(0).max(100000).optional(),
  messaggio: z.string().trim().max(2000).optional(),
  // Honeypot: campo invisibile a un utente reale (nascosto via CSS nel
  // form), che un bot che compila tutti i campi indiscriminatamente
  // riempie quasi sempre. Nessun vincolo qui apposta: deve poter
  // arrivare valorizzato senza far fallire la validazione, altrimenti
  // il bot riceverebbe un 400 invece della finta risposta di successo
  // gestita sotto — un segnale in più su cosa l'ha bloccato.
  sitoWeb: z.string().optional(),
});

// POST /api/contatti — punto 34 (contatti commerciali). Pubblica, senza
// autenticazione: chi scrive non ha ancora un account. Protezione spam
// a due livelli: rate limit per IP (leadFormLimiter) + honeypot.
contattiRouter.post("/", leadFormLimiter, async (req, res) => {
  const parsed = contattiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dati non validi", dettagli: parsed.error.flatten() });
  }
  const { sitoWeb, ...dati } = parsed.data;
  if (sitoWeb) {
    // Bot rilevato: risposta identica a quella di successo, nessun dato salvato.
    return res.status(201).json({ ok: true });
  }

  const lead = await prisma.lead.create({
    data: { ...dati, origine: "CONTATTO" },
  });

  inviaNotificaLeadCommerciale({ ...dati, origine: "CONTATTO" }).catch((err) => {
    console.error(`[contatti] Notifica email fallita per lead ${lead.id}:`, err.message);
  });

  res.status(201).json({ ok: true });
});
