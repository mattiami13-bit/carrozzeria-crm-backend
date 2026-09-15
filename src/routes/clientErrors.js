import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

// Punto 24 (monitoring, "errori frontend"): senza questo endpoint, un
// errore JavaScript nel gestionale del cliente è invisibile — nessuno lo
// sa finché non arriva una telefonata. Pubblico (un utente può avere un
// errore anche prima del login), ma con limiti stretti: non è un canale
// per dati arbitrari, solo un report di errore compatto.
export const clientErrorsRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const schema = z.object({
  messaggio: z.string().min(1).max(500),
  stack: z.string().max(3000).optional(),
  url: z.string().max(500).optional(),
  contesto: z.string().max(100).optional(),
}).strict();

clientErrorsRouter.post("/", limiter, (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Segnalazione non valida" });

  console.error(JSON.stringify({
    livello: "error",
    tipo: "errore_frontend",
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
    ...parsed.data,
  }));

  res.status(204).send();
});
