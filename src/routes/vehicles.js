import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { enqueueNotification } from "../lib/notifiche.js";

export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth);

export const STAGE_ORDER = [
  "ACCETTAZIONE",
  "PREVENTIVO",
  "ATTESA_APPROVAZIONE",
  "ORDINE_RICAMBI",
  "IN_LAVORAZIONE",
  "PREPARAZIONE",
  "VERNICIATURA",
  "LUCIDATURA",
  "CONTROLLO_QUALITA",
  "LAVAGGIO",
  "PRONTA_CONSEGNA",
  "CONSEGNATA",
];

// GET /api/vehicles?stage=VERNICIATURA&search=FG471RB
// Restituisce l'elenco usato sia dalla board (raggruppato per stage
// lato client) sia dalla ricerca globale per targa.
vehiclesRouter.get("/", async (req, res) => {
  const { stage, search } = req.query;
  const vehicles = await prisma.vehicle.findMany({
    where: {
      ...tenantScope(req),
      ...(stage ? { stage: String(stage) } : {}),
      ...(search
        ? {
            OR: [
              { targa: { contains: String(search), mode: "insensitive" } },
              { vin: { contains: String(search), mode: "insensitive" } },
              { numeroSinistro: { contains: String(search), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      client: { select: { nome: true, cognome: true, telefono: true } },
      tecnico: { select: { nome: true, cognome: true } },
      _count: { select: { photos: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(vehicles);
});

vehiclesRouter.get("/:id", async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      client: true,
      tecnico: true,
      photos: { orderBy: { createdAt: "asc" } },
      quotes: true,
      stageHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { nome: true, cognome: true } } } },
    },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });
  res.json(vehicle);
});

const vehicleSchema = z.object({
  clientId: z.string(),
  marca: z.string().min(1),
  modello: z.string().min(1),
  targa: z.string().min(1),
  vin: z.string().optional(),
  colore: z.string().optional(),
  km: z.number().int().optional(),
  compagniaAssicurativa: z.string().optional(),
  numeroSinistro: z.string().optional(),
  perito: z.string().optional(),
  tecnicoId: z.string().optional(),
  dataPrevistaConsegna: z.string().datetime().optional(),
});

vehiclesRouter.post("/", async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const vehicle = await prisma.vehicle.create({
    data: {
      ...parsed.data,
      ...tenantScope(req),
      dataPrevistaConsegna: parsed.data.dataPrevistaConsegna
        ? new Date(parsed.data.dataPrevistaConsegna)
        : undefined,
    },
  });

  // Prima riga di cronologia: l'accettazione stessa.
  await prisma.stageHistory.create({
    data: { vehicleId: vehicle.id, toStage: "ACCETTAZIONE", changedById: req.auth.userId },
  });

  res.status(201).json(vehicle);
});

const stageSchema = z.object({
  stage: z.enum(STAGE_ORDER),
});

// PATCH /api/vehicles/:id/stage
// Cambio stato: aggiorna il veicolo e scrive una riga di cronologia
// immutabile. Da qui si agganciano in futuro le notifiche WhatsApp
// automatiche (es. su transizione verso VERNICIATURA -> "in verniciatura",
// PRONTA_CONSEGNA -> "la sua auto è pronta").
vehiclesRouter.patch("/:id/stage", async (req, res) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const current = await prisma.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { client: true },
  });
  if (!current) return res.status(404).json({ error: "Veicolo non trovato" });

    const updated = await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.update({

  
      where: { id: current.id },
      data: {
        stage: parsed.data.stage,
        dataConsegnaEffettiva: parsed.data.stage === "CONSEGNATA" ? new Date() : undefined,
      },
      include: { client: true },
    });
    await tx.stageHistory.create({
      data: {
        vehicleId: vehicle.id,
        fromStage: current.stage,
        toStage: parsed.data.stage,
        changedById: req.auth.userId,
      },
    });
    return vehicle;
  });

  await enqueueNotification(updated, parsed.data.stage);

  res.json(updated);
});

vehiclesRouter.patch("/:id", async (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { count } = await prisma.vehicle.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data: {
      ...parsed.data,
      dataPrevistaConsegna: parsed.data.dataPrevistaConsegna
        ? new Date(parsed.data.dataPrevistaConsegna)
        : undefined,
    },
  });
  if (count === 0) return res.status(404).json({ error: "Veicolo non trovato" });

  const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
  res.json(vehicle);
});
