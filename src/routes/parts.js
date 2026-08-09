import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const partsRouter = Router();
partsRouter.use(requireAuth);

// GET /api/parts
// Elenco ricambi. Con ?sottoScorta=true restituisce solo i ricambi
// la cui giacenza è scesa a/sotto la scorta minima (per gli alert).
// Il confronto giacenza<=scortaMinima è fatto lato server dopo la query
// perché Prisma non supporta il confronto tra due colonne nel `where`;
// per un magazzino di dimensioni tipiche di una carrozzeria (decine/
// centinaia di articoli) il costo è trascurabile.
partsRouter.get("/", async (req, res) => {
  const { sottoScorta, search } = req.query;

  const parts = await prisma.part.findMany({
    where: {
      ...tenantScope(req),
      ...(search
        ? {
            OR: [
              { codice: { contains: String(search), mode: "insensitive" } },
              { descrizione: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { descrizione: "asc" },
  });

  const result =
    sottoScorta === "true"
      ? parts.filter((p) => p.giacenza <= p.scortaMinima)
      : parts;

  res.json(result);
});

partsRouter.get("/:id", async (req, res) => {
  const part = await prisma.part.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!part) return res.status(404).json({ error: "Ricambio non trovato" });
  res.json(part);
});

const partSchema = z.object({
  codice: z.string().min(1),
  descrizione: z.string().min(1),
  giacenza: z.number().int().nonnegative().default(0),
  scortaMinima: z.number().int().nonnegative().default(0),
  prezzoAcquisto: z.number().nonnegative(),
  prezzoVendita: z.number().nonnegative().optional(),
  fornitore: z.string().optional(),
});

// Crea un nuovo ricambio a magazzino. Il codice deve essere unico
// per tenant (vincolo già presente nello schema: @@unique([tenantId, codice])).
partsRouter.post("/", async (req, res) => {
  const parsed = partSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const part = await prisma.part.create({
      data: { ...tenantScope(req), ...parsed.data },
    });
    res.status(201).json(part);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Esiste già un ricambio con questo codice" });
    }
    throw err;
  }
});

const partUpdateSchema = partSchema.partial();

partsRouter.patch("/:id", async (req, res) => {
  const parsed = partUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { count } = await prisma.part.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data: parsed.data,
  });
  if (count === 0) return res.status(404).json({ error: "Ricambio non trovato" });

  const part = await prisma.part.findUnique({ where: { id: req.params.id } });
  res.json(part);
});

partsRouter.delete("/:id", async (req, res) => {
  const { count } = await prisma.part.deleteMany({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (count === 0) return res.status(404).json({ error: "Ricambio non trovato" });
  res.status(204).end();
});

// -----------------------------
// MOVIMENTI (carico / scarico)
// -----------------------------

const movementSchema = z.object({
  tipo: z.enum(["CARICO", "SCARICO"]),
  quantita: z.number().int().positive(),
});

// Registra un movimento e aggiorna la giacenza in una singola
// transazione, così i due dati non possono mai andare fuori sincrono
// (es. per un errore di rete a metà operazione).
partsRouter.post("/:id/movements", async (req, res) => {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const part = await prisma.part.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!part) return res.status(404).json({ error: "Ricambio non trovato" });

  const { tipo, quantita } = parsed.data;
  const delta = tipo === "CARICO" ? quantita : -quantita;

  if (tipo === "SCARICO" && quantita > part.giacenza) {
    return res.status(400).json({ error: "Quantità in scarico superiore alla giacenza disponibile" });
  }

  const [movement, updatedPart] = await prisma.$transaction([
    prisma.partMovement.create({
      data: { partId: part.id, tipo, quantita },
    }),
    prisma.part.update({
      where: { id: part.id },
      data: { giacenza: { increment: delta } },
    }),
  ]);

  res.status(201).json({ movement, part: updatedPart });
});
