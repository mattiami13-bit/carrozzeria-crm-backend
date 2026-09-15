import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const notificheRouter = Router();
notificheRouter.use(requireAuth);

const CATEGORIE_VALIDE = ["SISTEMA", "PRATICHE", "RICAMBI", "CLIENTI", "PAGAMENTI", "AI", "SICUREZZA"];

const listSchema = z.object({
  categoria: z.enum(CATEGORIE_VALIDE).optional(),
  letta: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

// Le notifiche sono personali: sempre scopate su tenant + utente
// corrente, mai su tutto il tenant, così un utente non vede mai le
// notifiche destinate a un collega.
notificheRouter.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { categoria, letta, limit, cursor } = parsed.data;

  const notifiche = await prisma.notification.findMany({
    where: {
      ...tenantScope(req),
      userId: req.auth.userId,
      ...(categoria ? { categoria } : {}),
      ...(letta !== undefined ? { letta: letta === "true" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = notifiche.length > limit;
  const page = hasMore ? notifiche.slice(0, limit) : notifiche;

  res.json({ notifiche: page, nextCursor: hasMore ? page[page.length - 1].id : null });
});

notificheRouter.get("/non-lette/count", async (req, res) => {
  const count = await prisma.notification.count({
    where: { ...tenantScope(req), userId: req.auth.userId, letta: false },
  });
  res.json({ count });
});

notificheRouter.patch("/:id/letta", async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { id: req.params.id, ...tenantScope(req), userId: req.auth.userId },
    data: { letta: true },
  });
  if (count === 0) return res.status(404).json({ error: "Notifica non trovata" });
  res.json({ ok: true });
});

notificheRouter.post("/segna-tutte-lette", async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { ...tenantScope(req), userId: req.auth.userId, letta: false },
    data: { letta: true },
  });
  res.json({ ok: true, aggiornate: count });
});
