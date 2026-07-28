import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

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
