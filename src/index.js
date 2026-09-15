import "dotenv/config";
import express from "express";
import cors from "cors";
import { photoTimelineRouter } from './routes/photoTimeline.js';

import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { quotesRouter } from "./routes/quotes.js";
import { partsRouter } from "./routes/parts.js";
import { loanerCarsRouter } from "./routes/loanerCars.js";
import { supplierOrdersRouter } from "./routes/supplierOrders.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { briefingRouter } from './routes/briefing.js';
import { startBriefingWorker } from './lib/briefing-service.js';
import { executiveRouter } from "./routes/executive.js";
import { photosRouter } from "./routes/photos.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { usersRouter } from "./routes/users.js";
import { sinistriRouter } from "./routes/sinistri.js";
import { assistenteRouter } from "./routes/assistente.js";
import { damageAssistantRouter, damageItemsRouter } from "./routes/damageAssistant.js";
import { partsTrackingRouter } from "./routes/partsTracking.js";
import { delayRouter } from "./routes/delay.js";
import { startDelayWorker } from "./lib/delay-service.js";
import { profitRouter } from "./routes/profit.js";
import { copilotRouter } from "./routes/copilot.js";
import { insuranceGapRouter, insuranceGapItemsRouter, insuranceGapSuggestionsRouter } from "./routes/insuranceGap.js";
import { whatsappRouter, whatsappWebhookRouter } from "./routes/whatsapp.js";
import { portaleRouter, portalDocumentsRouter, portalActionsRouter, portalDocumentItemRouter, portalActionItemRouter } from "./routes/portale.js";
import { vehicleWorkOrdersRouter, workOrdersRouter, workOrderTimeEntriesRouter, vehicleOreLavorateRouter } from "./routes/workOrders.js";
import { liveDashboardRouter } from "./routes/liveDashboard.js";
import { qcTemplateRouter, vehicleQcRouter, qcInspectionRouter, qcNonConformitaRouter } from "./routes/qc.js";
import { notificheRouter } from "./routes/notifiche.js";
import { gdprRouter } from "./routes/gdpr.js";
import { billingRouter, billingWebhookRouter } from "./routes/billing.js";
import { auditLogger } from "./middleware/audit.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Dietro il proxy di Railway: serve per ricostruire correttamente
// protocollo/host pubblici (link portale nei messaggi, validazione firma
// webhook Twilio).
app.set("trust proxy", true);

app.use(cors());
app.use("/api/profit", express.json({limit:"1mb"}));
app.use("/api/photo-timeline", express.json({limit:"1mb"}));
app.use("/api/parts-tracking", express.json({limit:"1mb"}));
app.use("/api/delay", express.json({limit:"1mb"}));
// Twilio invia i webhook come form url-encoded, non JSON.
app.use("/api/whatsapp/webhook", express.urlencoded({ extended: false }));
// Stripe firma il BODY GREZZO: deve restare non parsato come JSON fino a
// dopo la verifica della firma dentro billingWebhookRouter.
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(auditLogger);

if (process.env.CRM_PREVIEW === "1") app.use("/crm", express.static(path.join(__dirname, "..", "frontend")));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/portale", express.static(path.join(__dirname, "..", "public", "portale")));
app.use("/verifica-email", express.static(path.join(__dirname, "..", "public", "verifica-email")));
app.use("/reset-password", express.static(path.join(__dirname, "..", "public", "reset-password")));
app.use("/privacy", express.static(path.join(__dirname, "..", "public", "privacy")));
app.use("/cookie", express.static(path.join(__dirname, "..", "public", "cookie")));
app.use("/termini", express.static(path.join(__dirname, "..", "public", "termini")));
app.use("/dpa", express.static(path.join(__dirname, "..", "public", "dpa")));
app.use("/billing/successo", express.static(path.join(__dirname, "..", "public", "billing-successo")));
app.use("/billing/annullato", express.static(path.join(__dirname, "..", "public", "billing-annullato")));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/parts", partsRouter);
app.use("/api/sinistri", sinistriRouter);
app.use("/api/assistente", assistenteRouter);
app.use("/api/vehicles/:vehicleId/damage-assistant", damageAssistantRouter);
app.use("/api/damage-items", damageItemsRouter);
app.use("/api/copilot", copilotRouter);
app.use("/api/vehicles/:vehicleId/insurance-gap", insuranceGapRouter);
app.use("/api/insurance-gap-items", insuranceGapItemsRouter);
app.use("/api/insurance-gap-suggestions", insuranceGapSuggestionsRouter);
app.use("/api/whatsapp/webhook", whatsappWebhookRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/profit", profitRouter);
app.use("/api/delay", delayRouter);
app.use("/api/parts-tracking", partsTrackingRouter);
app.use("/api/photo-timeline", photoTimelineRouter);
app.use("/api/portale", portaleRouter);
app.use("/api/vehicles/:vehicleId/portal-documents", portalDocumentsRouter);
app.use("/api/vehicles/:vehicleId/portal-actions", portalActionsRouter);
app.use("/api/portal-documents", portalDocumentItemRouter);
app.use("/api/portal-actions", portalActionItemRouter);
app.use("/api/vehicles/:vehicleId/work-orders", vehicleWorkOrdersRouter);
app.use("/api/vehicles/:vehicleId/ore-lavorate", vehicleOreLavorateRouter);
app.use("/api/work-orders", workOrdersRouter);
app.use("/api/work-order-time-entries", workOrderTimeEntriesRouter);
app.use("/api/live-dashboard", liveDashboardRouter);
app.use("/api/qc/template", qcTemplateRouter);
app.use("/api/vehicles/:vehicleId/qc", vehicleQcRouter);
app.use("/api/qc/inspections", qcInspectionRouter);
app.use("/api/qc/non-conformita", qcNonConformitaRouter);
app.use("/api/loaner-cars", loanerCarsRouter);
app.use("/api/supplier-orders", supplierOrdersRouter);
app.use("/api/executive", executiveRouter);
app.use("/api/briefing", briefingRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/notifiche", notificheRouter);
app.use("/api/gdpr", gdprRouter);
app.use("/api/billing/webhook", billingWebhookRouter);
// billingRouter va montato PRIMA di "/api", photosRouter qui sotto:
// photosRouter applica requireAuth senza filtro di percorso, quindi
// intercetterebbe (con 401) anche le rotte pubbliche di billing come
// GET /api/billing/piani se fosse raggiunto per primo — l'ordine di
// registrazione dei middleware in Express decide chi vede la richiesta.
app.use("/api/billing", billingRouter);
app.use("/api", photosRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/users", usersRouter);

// Gestione errori centralizzata: qualsiasi errore non gestito nelle
// route arriva qui invece di far crashare il processo.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Errore interno del server" });
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`API in ascolto su http://localhost:${port}`);
  if (process.env.DELAY_WORKER !== "0") startDelayWorker();
  if (process.env.BRIEFING_WORKER !== "0") startBriefingWorker();
});
