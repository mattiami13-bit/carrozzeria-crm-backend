import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const sinistriRouter = Router();
sinistriRouter.use(requireAuth);

const sinistroSchema = z.object({
  clientId: z.string(),
  vehicleId: z.string().optional(),
  numeroPratica: z.string().optional(),
  compagniaAssicurativa: z.string(),
  perito: z.string().optional(),
  responsabile: z.string().optional(),
  stato: z
    .enum([
      "APERTO",
      "INVIATO_ASSICURAZIONE",
      "PERIZIA_FISSATA",
      "PERIZIA_COMPLETATA",
      "APPROVATO",
      "LAVORAZIONE",
      "COMPLETATO",
      "LIQUIDATO",
    ])
    .optional(),
  importoTotale: z.coerce.number().optional(),
  percentualeFranchigia: z.coerce.number().optional(),
  importoFranchigia: z.coerce.number().optional(),
  importoPagatoAssicurazione: z.coerce.number().optional(),
  importoPagatoCliente: z.coerce.number().optional(),
  note: z.string().optional(),
});

// Calcola la franchigia automaticamente se non specificata manualmente,
// ma è nota la percentuale e l'importo totale
function calcolaFranchigia(data) {
  if (
    data.importoFranchigia === undefined &&
    data.percentualeFranchigia !== undefined &&
    data.importoTotale !== undefined
  ) {
    data.importoFranchigia = Number(
      ((data.importoTotale * data.percentualeFranchigia) / 100).toFixed(2)
    );
  }
  return data;
}

// GET /api/sinistri?stato=APERTO&clientId=...&vehicleId=...&search=...
sinistriRouter.get("/", async (req, res) => {
  const { stato, clientId, vehicleId, search } = req.query;

  const sinistri = await prisma.sinistro.findMany({
    where: {
      ...tenantScope(req),
      ...(stato ? { stato } : {}),
      ...(clientId ? { clientId } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(search
        ? {
            OR: [
              { numeroPratica: { contains: String(search), mode: "insensitive" } },
              { compagniaAssicurativa: { contains: String(search), mode: "insensitive" } },
              { perito: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { client: true, vehicle: true },
    orderBy: { dataApertura: "desc" },
  });

  res.json(sinistri);
});

// GET /api/sinistri/:id
sinistriRouter.get("/:id", async (req, res) => {
  const sinistro = await prisma.sinistro.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { client: true, vehicle: true },
  });
  if (!sinistro) return res.status(404).json({ error: "Sinistro non trovato" });
  res.json(sinistro);
});

// POST /api/sinistri
sinistriRouter.post("/", async (req, res) => {
  const parsed = sinistroSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = calcolaFranchigia({ ...parsed.data });

  const sinistro = await prisma.sinistro.create({
    data: { ...data, ...tenantScope(req) },
    include: { client: true, vehicle: true },
  });
  res.status(201).json(sinistro);
});

// PATCH /api/sinistri/:id
sinistriRouter.patch("/:id", async (req, res) => {
  const parsed = sinistroSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = calcolaFranchigia({ ...parsed.data });

  const { count } = await prisma.sinistro.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data,
  });
  if (count === 0) return res.status(404).json({ error: "Sinistro non trovato" });

  const sinistro = await prisma.sinistro.findUnique({
    where: { id: req.params.id },
    include: { client: true, vehicle: true },
  });
  res.json(sinistro);
});