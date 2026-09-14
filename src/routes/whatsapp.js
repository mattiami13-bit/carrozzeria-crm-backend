import { Router } from "express";
import twilio from "twilio";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { WHATSAPP_EVENTI, EVENTO_LABEL, TEMPLATE_DEFAULT, inviaComunicazioneWhatsapp } from "../lib/whatsapp.js";

// Gestione comunicazioni automatiche WhatsApp legate al workflow pratica:
// - configurazione template per evento (solo ADMIN, come richiesto: è
//   l'amministratore a decidere quali cambi di stato comunicano al cliente)
// - registro messaggi (letto da chi vede la scheda veicolo)
// - trigger manuale per l'evento "ricambio in ritardo" (non è un vero
//   cambio di stato della pratica, quindi va segnalato dall'operatore)
// - webhook Twilio per stato di consegna e risposte del cliente

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// GET /api/whatsapp/templates — un elemento per ogni evento possibile,
// con il testo salvato oppure la bozza di default se non ancora configurato.
whatsappRouter.get("/templates", requireRole("ADMIN"), wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const salvati = await prisma.whatsappTemplate.findMany({ where: { tenantId } });
  const byEvento = Object.fromEntries(salvati.map((t) => [t.evento, t]));

  const templates = WHATSAPP_EVENTI.map((evento) => {
    const t = byEvento[evento];
    return {
      evento,
      label: EVENTO_LABEL[evento],
      attivo: t?.attivo ?? false,
      testo: t?.testo ?? TEMPLATE_DEFAULT[evento],
      personalizzato: Boolean(t),
      updatedAt: t?.updatedAt ?? null,
    };
  });
  res.json(templates);
}));

const templateSchema = z.object({
  attivo: z.boolean(),
  testo: z.string().min(1).max(2000),
});

// PUT /api/whatsapp/templates/:evento
whatsappRouter.put("/templates/:evento", requireRole("ADMIN"), wrap(async (req, res) => {
  const evento = req.params.evento;
  if (!WHATSAPP_EVENTI.includes(evento)) return res.status(400).json({ error: "Evento non valido" });

  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { tenantId } = tenantScope(req);
  const template = await prisma.whatsappTemplate.upsert({
    where: { tenantId_evento: { tenantId, evento } },
    update: { attivo: parsed.data.attivo, testo: parsed.data.testo, aggiornatoDaId: req.auth.userId },
    create: { tenantId, evento, attivo: parsed.data.attivo, testo: parsed.data.testo, aggiornatoDaId: req.auth.userId },
  });
  res.json(template);
}));

// GET /api/whatsapp/vehicles/:vehicleId/messages — registro dei messaggi
// WhatsApp inviati per questa pratica (data/ora, stato, errore, risposta).
whatsappRouter.get("/vehicles/:vehicleId/messages", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: req.params.vehicleId, tenantId } });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const messaggi = await prisma.whatsappMessage.findMany({
    where: { vehicleId: vehicle.id, tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(messaggi);
}));

// POST /api/whatsapp/vehicles/:vehicleId/ricambio-ritardo
// Trigger manuale: il ritardo di un ricambio non è un cambio di stato
// della pratica, quindi è l'operatore a decidere caso per caso se
// comunicarlo al cliente (come richiesto: "eventuale comunicazione").
whatsappRouter.post("/vehicles/:vehicleId/ricambio-ritardo", wrap(async (req, res) => {
  const { tenantId } = tenantScope(req);
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: req.params.vehicleId, tenantId },
    include: { client: true, sinistri: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!vehicle) return res.status(404).json({ error: "Veicolo non trovato" });

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const risultato = await inviaComunicazioneWhatsapp(vehicle, "RICAMBIO_RITARDO", baseUrl, req.auth.userId);

  if (!risultato) {
    return res.status(422).json({
      error: "Comunicazione non inviata: verifica che l'evento sia attivo nelle impostazioni WhatsApp, che il cliente abbia dato il consenso e abbia un numero di telefono.",
    });
  }
  res.status(201).json(risultato);
}));

// --- WEBHOOK TWILIO (senza requireAuth: arrivano da Twilio, non dallo staff) ---
export const whatsappWebhookRouter = Router();

function validaFirmaTwilio(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers["x-twilio-signature"];
  if (!authToken || !signature) return false;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body || {});
}

// POST /api/whatsapp/webhook/status — Twilio invia qui MessageSid + MessageStatus
// (sent, delivered, read, failed, undelivered) per ogni messaggio inviato.
whatsappWebhookRouter.post("/status", wrap(async (req, res) => {
  if (!validaFirmaTwilio(req)) return res.status(403).send("Firma non valida");

  const { MessageSid, MessageStatus, ErrorMessage } = req.body || {};
  if (!MessageSid) return res.status(204).send();

  const statoMap = { delivered: "CONSEGNATO", read: "LETTO", failed: "FALLITO", undelivered: "FALLITO" };
  const nuovoStato = statoMap[String(MessageStatus || "").toLowerCase()];
  if (nuovoStato) {
    await prisma.whatsappMessage.updateMany({
      where: { providerMessageSid: MessageSid },
      data: { stato: nuovoStato, ...(ErrorMessage ? { errore: String(ErrorMessage).slice(0, 500) } : {}) },
    });
  }
  res.status(204).send();
}));

// POST /api/whatsapp/webhook/inbound — Twilio invia qui i messaggi che il
// cliente scrive in risposta. Associamo la risposta all'ultimo messaggio
// inviato a quel numero (multi-tenant: il numero Twilio WhatsApp è
// condiviso, quindi il match avviene sul numero del cliente).
whatsappWebhookRouter.post("/inbound", wrap(async (req, res) => {
  if (!validaFirmaTwilio(req)) return res.status(403).send("Firma non valida");

  const { From, Body } = req.body || {};
  const numero = String(From || "").replace(/^whatsapp:/, "");
  if (numero && Body) {
    const ultimo = await prisma.whatsappMessage.findFirst({
      where: { telefono: numero },
      orderBy: { createdAt: "desc" },
    });
    if (ultimo) {
      await prisma.whatsappMessage.update({
        where: { id: ultimo.id },
        data: { stato: "RISPOSTA_RICEVUTA", rispostaTesto: String(Body).slice(0, 2000), rispostaAt: new Date() },
      });
    }
  }
  res.set("Content-Type", "text/xml").status(200).send("<Response></Response>");
}));
