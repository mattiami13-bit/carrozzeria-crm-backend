import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

const appointmentSchema = z.object({
  clientId: z.string().optional().nullable(),
  vehicleId: z.string().optional().nullable(),
  tecnicoId: z.string().optional().nullable(),
  tipo: z.enum(["CLIENTE", "INTERNO"]).default("CLIENTE"),
  titolo: z.string().min(1, "Il titolo è obbligatorio"),
  inizio: z.string().min(1, "La data di inizio è obbligatoria"),
  fine: z.string().min(1, "La data di fine è obbligatoria"),
  note: z.string().optional().nullable(),
});

// GET /api/appointments?from=2026-07-27&to=2026-08-02
// Restituisce gli appuntamenti nell'intervallo di date richiesto (per la vista calendario).
// Se from/to non sono passati, restituisce tutti gli appuntamenti del tenant.
appointmentsRouter.get("/", async (req, res) => {
  const { from, to } = req.query;
  const appointments = await prisma.appointment.findMany({
    where: {
      ...tenantScope(req),
      ...(from || to
        ? {
            inizio: {
              ...(from ? { gte: new Date(String(from)) } : {}),
              ...(to ? { lte: new Date(String(to)) } : {}),
            },
          }
        : {}),
    },
    include: {
      client: { select: { id: true, nome: true, cognome: true, telefono: true } },
      vehicle: { select: { id: true, marca: true, modello: true, targa: true } },
      tecnico: { select: { id: true, nome: true, cognome: true } },
    },
    orderBy: { inizio: "asc" },
  });
  res.json(appointments);
});

// GET /api/appointments/:id
appointmentsRouter.get("/:id", async (req, res) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      client: { select: { id: true, nome: true, cognome: true, telefono: true } },
      vehicle: { select: { id: true, marca: true, modello: true, targa: true } },
      tecnico: { select: { id: true, nome: true, cognome: true } },
    },
  });
  if (!appointment) return res.status(404).json({ error: "Appuntamento non trovato" });
  res.json(appointment);
});

// POST /api/appointments
appointmentsRouter.post("/", async (req, res) => {
  const parsed = appointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  const inizio = new Date(data.inizio);
  const fine = new Date(data.fine);
  if (fine <= inizio) {
    return res.status(400).json({ error: "L'orario di fine deve essere successivo a quello di inizio" });
  }

  const appointment = await prisma.appointment.create({
    data: {
      tenantId: req.auth.tenantId,
      clientId: data.clientId || null,
      vehicleId: data.vehicleId || null,
      tecnicoId: data.tecnicoId || null,
      tipo: data.tipo,
      titolo: data.titolo,
      inizio,
      fine,
      note: data.note || null,
    },
    include: {
      client: { select: { id: true, nome: true, cognome: true, telefono: true } },
      vehicle: { select: { id: true, marca: true, modello: true, targa: true } },
      tecnico: { select: { id: true, nome: true, cognome: true } },
    },
  });

  res.status(201).json(appointment);
});

// PUT /api/appointments/:id
appointmentsRouter.put("/:id", async (req, res) => {
  const existing = await prisma.appointment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) return res.status(404).json({ error: "Appuntamento non trovato" });

  const parsed = appointmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  const inizio = data.inizio ? new Date(data.inizio) : existing.inizio;
  const fine = data.fine ? new Date(data.fine) : existing.fine;
  if (fine <= inizio) {
    return res.status(400).json({ error: "L'orario di fine deve essere successivo a quello di inizio" });
  }

  const appointment = await prisma.appointment.update({
    where: { id: req.params.id },
    data: {
      ...(data.clientId !== undefined ? { clientId: data.clientId || null } : {}),
      ...(data.vehicleId !== undefined ? { vehicleId: data.vehicleId || null } : {}),
      ...(data.tecnicoId !== undefined ? { tecnicoId: data.tecnicoId || null } : {}),
      ...(data.tipo !== undefined ? { tipo: data.tipo } : {}),
      ...(data.titolo !== undefined ? { titolo: data.titolo } : {}),
      ...(data.inizio !== undefined ? { inizio } : {}),
      ...(data.fine !== undefined ? { fine } : {}),
      ...(data.note !== undefined ? { note: data.note || null } : {}),
    },
    include: {
      client: { select: { id: true, nome: true, cognome: true, telefono: true } },
      vehicle: { select: { id: true, marca: true, modello: true, targa: true } },
      tecnico: { select: { id: true, nome: true, cognome: true } },
    },
  });

  res.json(appointment);
});

// DELETE /api/appointments/:id
appointmentsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.appointment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) return res.status(404).json({ error: "Appuntamento non trovato" });

  await prisma.appointment.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
