import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const changelogRouter = Router();

// GET /api/changelog — pubblica, senza autenticazione: la pagina
// /novita la legge prima che un visitatore abbia un account.
changelogRouter.get("/", async (req, res) => {
  const voci = await prisma.changelogEntry.findMany({
    orderBy: { data: "desc" },
    select: { id: true, titolo: true, descrizione: true, data: true },
  });
  res.json(voci);
});
