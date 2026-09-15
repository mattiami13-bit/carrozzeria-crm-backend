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
import { startPhotoBackupWorker } from './lib/photo-backup-service.js';
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
import { maintenanceMode } from "./middleware/maintenance.js";
import { requireAbbonamentoAttivo } from "./middleware/subscription.js";
import { latencyLogger } from "./middleware/latency.js";
import { clientErrorsRouter } from "./routes/clientErrors.js";
import { statoSalute } from "./lib/health.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fail-fast: senza un JWT_SECRET robusto, jsonwebtoken firmerebbe/verificherebbe
// comunque i token (con un valore undefined o debole), esponendo un rischio di
// forgery scoperto solo in produzione. Meglio non avviarsi affatto.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET mancante o troppo corto (minimo 32 caratteri): impostalo nelle variabili d'ambiente prima di avviare il server.");
  process.exit(1);
}

const app = express();
// Dietro il proxy di Railway: serve per ricostruire correttamente
// protocollo/host pubblici (link portale nei messaggi, validazione firma
// webhook Twilio). "1" (un solo hop, non "true"/tutti) perché altrimenti
// un client potrebbe falsificare X-Forwarded-For per aggirare il rate
// limiting basato su IP.
app.set("trust proxy", 1);

// Origini ammesse per le richieste browser: il dominio pubblico e, in
// sviluppo, localhost. L'auth è Bearer JWT (mai cookie), quindi CORS non è
// la barriera di sicurezza primaria, ma restringerlo riduce comunque la
// superficie a siti di terze parti che riusano un token trafugato.
const allowedOrigins = (process.env.CORS_ORIGINS || "https://www.rifless.it,https://rifless.it,http://localhost:3000,http://localhost:5173,http://localhost:4310")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // Nessun header Origin (curl, richieste server-to-server, webhook): consentito.
    // Origin "null": il gestionale viene aperto oggi come file HTML locale
    // (file://), che il browser marca così — è l'uso reale attuale dell'app,
    // non va bloccato.
    if (!origin || origin === "null" || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Origine non consentita da CORS"));
  },
}));
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
app.use(latencyLogger);

// Health endpoint "vero": verifica davvero il database (la dipendenza
// più critica) invece di rispondere sempre ok — vedi src/lib/health.js.
app.get("/health", async (req, res) => {
  const stato = await statoSalute();
  res.status(stato.ok ? 200 : 503).json(stato);
});
app.use(maintenanceMode);

if (process.env.CRM_PREVIEW === "1") app.use("/crm", express.static(path.join(__dirname, "..", "frontend")));

app.use("/", express.static(path.join(__dirname, "..", "public", "home")));
app.use("/portale", express.static(path.join(__dirname, "..", "public", "portale")));
app.use("/verifica-email", express.static(path.join(__dirname, "..", "public", "verifica-email")));
app.use("/reset-password", express.static(path.join(__dirname, "..", "public", "reset-password")));
app.use("/privacy", express.static(path.join(__dirname, "..", "public", "privacy")));
app.use("/cookie", express.static(path.join(__dirname, "..", "public", "cookie")));
app.use("/termini", express.static(path.join(__dirname, "..", "public", "termini")));
app.use("/dpa", express.static(path.join(__dirname, "..", "public", "dpa")));
app.use("/billing/successo", express.static(path.join(__dirname, "..", "public", "billing-successo")));
app.use("/billing/annullato", express.static(path.join(__dirname, "..", "public", "billing-annullato")));

// Auth, billing (webhook + router) e GDPR sono registrati PRIMA del
// controllo abbonamento sotto: devono restare raggiungibili anche per
// un tenant bloccato, altrimenti non potrebbe né autenticarsi, né
// pagare per riattivarsi, né esportare/cancellare i propri dati. Per
// lo stesso motivo l'ordine di registrazione qui è quello che decide
// (vedi anche la nota su photosRouter più sotto): una rotta già
// intercettata da uno di questi router non raggiunge mai il middleware
// successivo.
app.use("/api/auth", authRouter);
app.use("/api/billing/webhook", billingWebhookRouter);
app.use("/api/billing", billingRouter);
app.use("/api/gdpr", gdprRouter);
app.use("/api/whatsapp/webhook", whatsappWebhookRouter);
app.use("/api/portale", portaleRouter);
app.use("/api/client-errors", clientErrorsRouter);

// Punto 23 (subscription required): da qui in giù, un tenant con
// abbonamento scaduto/non attivo riceve 402 invece di poter continuare
// a usare il gestionale. Vedi middleware/subscription.js.
app.use("/api", requireAbbonamentoAttivo);

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
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/profit", profitRouter);
app.use("/api/delay", delayRouter);
app.use("/api/parts-tracking", partsTrackingRouter);
app.use("/api/photo-timeline", photoTimelineRouter);
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
// photosRouter applica requireAuth senza filtro di percorso, quindi
// intercetterebbe (con 401) qualunque rotta "/api/..." successiva se
// registrato prima — deve restare l'ultimo dei router generici.
app.use("/api", photosRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/users", usersRouter);

// Punto 23 (pagina 404): nessuna rotta precedente ha risposto, quindi il
// percorso non esiste davvero. JSON per l'API (consumata da codice, non
// da un browser), pagina brandizzata per tutto il resto — al posto
// dell'HTML grezzo di default di Express ("Cannot GET /x").
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Non trovato" });
  res.status(404).sendFile(path.join(__dirname, "..", "public", "404", "index.html"));
});

// Gestione errori centralizzata: qualsiasi errore non gestito nelle
// route arriva qui invece di far crashare il processo. Log strutturato
// (una riga JSON) sul server — mai dettagli interni (stack, SQL, path
// del filesystem) nella risposta al client, solo un messaggio generico.
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    livello: "error",
    timestamp: new Date().toISOString(),
    metodo: req.method,
    percorso: req.originalUrl,
    tenantId: req.auth?.tenantId ?? null,
    userId: req.auth?.userId ?? null,
    messaggio: err.message,
    stack: err.stack,
  }));
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: "Errore interno del server" });
  }
  res.status(500).sendFile(path.join(__dirname, "..", "public", "500", "index.html"));
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`API in ascolto su http://localhost:${port}`);
  if (process.env.DELAY_WORKER !== "0") startDelayWorker();
  if (process.env.BRIEFING_WORKER !== "0") startBriefingWorker();
  if (process.env.PHOTO_BACKUP_WORKER !== "0") startPhotoBackupWorker();
});
