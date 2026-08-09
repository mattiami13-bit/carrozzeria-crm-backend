import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const loanerCarsRouter = Router();
loanerCarsRouter.use(requireAuth);

// GET /api/loaner-cars
// Elenco auto sostitutive, con la prenotazione attualmente in corso
// (dataFine nulla = auto ancora fuori) inclusa, per sapere a colpo
// d'occhio chi ce l'ha e da quando.
loanerCarsRouter.get("/", async (req, res) => {
  const cars = await prisma.loanerCar.findMany({
    where: tenantScope(req),
    include: {
      bookings: {
        where: { dataFine: null },
        orderBy: { dataInizio: "desc" },
        take: 1,
      },
    },
    orderBy: { targa: "asc" },
  });
  res.json(cars);
});

loanerCarsRouter.get("/:id", async (req, res) => {
  const car = await prisma.loanerCar.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      bookings: { orderBy: { dataInizio: "desc" }, take: 20 },
    },
  });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  res.json(car);
});

const carSchema = z.object({
  targa: z.string().min(1),
  marca: z.string().min(1),
  modello: z.string().min(1),
});

loanerCarsRouter.post("/", async (req, res) => {
  const parsed = carSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const car = await prisma.loanerCar.create({
    data: { ...tenantScope(req), ...parsed.data },
  });
  res.status(201).json(car);
});

const carUpdateSchema = carSchema.partial();

loanerCarsRouter.patch("/:id", async (req, res) => {
  const parsed = carUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { count } = await prisma.loanerCar.updateMany({
    where: { id: req.params.id, ...tenantScope(req) },
    data: parsed.data,
  });
  if (count === 0) return res.status(404).json({ error: "Auto sostitutiva non trovata" });

  const car = await prisma.loanerCar.findUnique({ where: { id: req.params.id } });
  res.json(car);
});

loanerCarsRouter.delete("/:id", async (req, res) => {
  const { count } = await prisma.loanerCar.deleteMany({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (count === 0) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  res.status(204).end();
});

// -----------------------------
// PRENOTAZIONI (assegnazione / rientro)
// -----------------------------

const bookingSchema = z.object({
  clientId: z.string().min(1),
});

// Assegna l'auto a un cliente: crea la prenotazione e marca l'auto
// come non disponibile. Blocca se l'auto ha già una prenotazione
// aperta (dataFine nulla), per evitare doppie assegnazioni.
loanerCarsRouter.post("/:id/bookings", async (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const car = await prisma.loanerCar.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { bookings: { where: { dataFine: null } } },
  });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  if (car.bookings.length > 0) {
    return res.status(409).json({ error: "Questa auto è già assegnata a un cliente" });
  }

  const [booking] = await prisma.$transaction([
    prisma.loanerBooking.create({
      data: { loanerCarId: car.id, clientId: parsed.data.clientId, dataInizio: new Date() },
    }),
    prisma.loanerCar.update({ where: { id: car.id }, data: { disponibile: false } }),
  ]);

  res.status(201).json(booking);
});

// Registra il rientro dell'auto: chiude la prenotazione aperta e
// rimette l'auto disponibile.
loanerCarsRouter.patch("/:id/rientro", async (req, res) => {
  const car = await prisma.loanerCar.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { bookings: { where: { dataFine: null } } },
  });
  if (!car) return res.status(404).json({ error: "Auto sostitutiva non trovata" });
  if (car.bookings.length === 0) {
    return res.status(400).json({ error: "Questa auto non risulta assegnata a nessuno" });
  }

  const [booking] = await prisma.$transaction([
    prisma.loanerBooking.update({
      where: { id: car.bookings[0].id },
      data: { dataFine: new Date() },
    }),
    prisma.loanerCar.update({ where: { id: car.id }, data: { disponibile: true } }),
  ]);

  res.json(booking);
});
