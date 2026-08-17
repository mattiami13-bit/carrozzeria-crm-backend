import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { inviaLinkPortale } from "../lib/notifiche.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const portaleRouter = Router();

// STAFF (autenticato): genera — o riusa se già esiste — il link di
// accesso pubblico per un veicolo. Il token non viene mai rigenerato
// se ne esiste già uno attivo, per non invalidare link già inviati.
portaleRouter.post("/genera/:vehicleId", requireAuth, async (req, res) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.vehicleId, ...tenantScope(req) },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  let access = await prisma.portalAccess.findFirst({
    where: { vehicleId: vehicle.id, attivo: true },
  });

let appenaCreato = false;
  if (!access) {
    const token = crypto.randomBytes(32).toString("hex");
    access = await prisma.portalAccess.create({
      data: { tenantId: req.auth.tenantId, vehicleId: vehicle.id, token },
    });
    appenaCreato = true;
  }

  if (appenaCreato) {
    const vehicleConCliente = await prisma.vehicle.findUnique({
      where: { id: vehicle.id },
      include: { client: true },
    });
    const link = `${req.protocol}://${req.get("host")}/portale/?t=${access.token}`;
    inviaLinkPortale(vehicleConCliente, link); // non blocca la risposta: invio in background
  }

  res.status(201).json({ token: access.token });
});

// CLIENTE (pubblico, nessun login): consulta lo stato del proprio
// veicolo tramite il token ricevuto via email. Nessuna lista, nessun
// altro dato del tenant è raggiungibile da qui.
portaleRouter.get("/:token", async (req, res) => {
  const access = await prisma.portalAccess.findUnique({
    where: { token: req.params.token },
  });
  if (!access || !access.attivo) {
    return res.status(404).json({ error: "Link non valido o scaduto" });
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: access.vehicleId },
    include: {
      client: { select: { nome: true, cognome: true } },
      photos: { orderBy: { createdAt: "asc" } },
      stageHistory: { orderBy: { changedAt: "asc" } },
      quotes: { orderBy: { createdAt: "desc" }, take: 1, include: { items: true } },
      sinistri: true,
    },
  });

  await prisma.portalAccess.update({
    where: { id: access.id },
    data: { ultimoAccessoAt: new Date() },
  });

  res.json({
    veicolo: {
      marca: vehicle.marca,
      modello: vehicle.modello,
      targa: vehicle.targa,
      stage: vehicle.stage,
      dataPrevistaConsegna: vehicle.dataPrevistaConsegna,
    },
    cliente: vehicle.client,
    foto: vehicle.photos,
    storicoStage: vehicle.stageHistory,
    preventivo: vehicle.quotes[0] ?? null,
    sinistro: vehicle.sinistri[0] ?? null,
  });
});

// CLIENTE (pubblico, nessun login): firma il preventivo collegato al
// proprio veicolo. Il preventivo deve appartenere ESATTAMENTE al veicolo
// di questo token — impedisce di firmare preventivi di altri veicoli
// anche riusando un token valido ma diverso.
portaleRouter.post("/:token/firma-preventivo", async (req, res) => {
  const { firmaDataUrl, firmatarioNome } = req.body;
  if (!firmaDataUrl || !firmatarioNome) {
    return res.status(400).json({ error: "Firma o nome mancante." });
  }

  const access = await prisma.portalAccess.findUnique({
    where: { token: req.params.token },
  });
  if (!access || !access.attivo) {
    return res.status(404).json({ error: "Link non valido o scaduto" });
  }

  const quote = await prisma.quote.findFirst({
    where: { vehicleId: access.vehicleId, tenantId: access.tenantId },
    orderBy: { createdAt: "desc" },
  });
  if (!quote) return res.status(404).json({ error: "Nessun preventivo da firmare per questo veicolo." });
  if (quote.stato !== "INVIATO") {
    return res.status(400).json({ error: "Questo preventivo non è firmabile in questo momento." });
  }
import { prisma } from "../lib/prisma.js";
import { inviaLinkPortale } from "../lib/notifiche.js";
  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      firmaDataUrl,
      firmatarioNome,
      firmatoAt: new Date(),
      stato: "ACCETTATO",
    },
  });

  res.json(updated);
});