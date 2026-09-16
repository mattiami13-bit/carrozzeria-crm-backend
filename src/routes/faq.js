import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const faqRouter = Router();

// GET /api/faq — pubblica, senza autenticazione: la pagina /faq la
// chiama prima che un visitatore abbia un account. Solo le voci attive,
// nell'ordine scelto dal super-admin.
faqRouter.get("/", async (req, res) => {
  const faq = await prisma.faqItem.findMany({
    where: { attiva: true },
    orderBy: { ordine: "asc" },
    select: { id: true, domanda: true, risposta: true },
  });
  res.json(faq);
});
