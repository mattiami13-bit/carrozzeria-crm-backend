import express from "express";
import cors from "cors";
import helmet from "helmet";
import { photoTimelineRouter } from './routes/photoTimeline.js';

import { authRouter } from "./routes/auth.js";
import { superAdminRouter } from "./routes/superAdmin.js";
import { clientsRouter } from "./routes/clients.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { quotesRouter } from "./routes/quotes.js";
import { partsRouter } from "./routes/parts.js";
import { loanerCarsRouter } from "./routes/loanerCars.js";
import { supplierOrdersRouter } from "./routes/supplierOrders.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { briefingRouter } from './routes/briefing.js';
import { executiveRouter } from "./routes/executive.js";
import { photosRouter } from "./routes/photos.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { usersRouter } from "./routes/users.js";
import { sinistriRouter } from "./routes/sinistri.js";
import { assistenteRouter } from "./routes/assistente.js";
import { damageAssistantRouter, damageItemsRouter } from "./routes/damageAssistant.js";
import { partsTrackingRouter } from "./routes/partsTracking.js";
import { delayRouter } from "./routes/delay.js";
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
import { requireFeature } from "./middleware/feature.js";
import { requireFlag } from "./middleware/featureFlag.js";
import { latencyLogger } from "./middleware/latency.js";
import { clientErrorsRouter } from "./routes/clientErrors.js";
import { contattiRouter } from "./routes/contatti.js";
import { demoRouter } from "./routes/demo.js";
import { faqRouter } from "./routes/faq.js";
import { changelogRouter } from "./routes/changelog.js";
import { supportRouter } from "./routes/support.js";
import { statoSalute } from "./lib/health.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Punto 47 (test end-to-end reale): la costruzione dell'app vive qui,
// separata da index.js (che si limita ad avviarla + far partire i
// worker), proprio per poter essere riusata da un test di integrazione
// vero — contro l'app COMPLETA, stesso ordine di montaggio della
// produzione — invece di duplicare a mano un sottoinsieme di router in
// ogni file di test (rischio di disallineamento tra cosa viene
// testato e cosa gira davvero, lo stesso tipo di scarto già corretto
// ai punti 44/45).
export function buildApp() {
  const app = express();
  // Dietro il proxy di Railway: serve per ricostruire correttamente
  // protocollo/host pubblici (link portale nei messaggi, validazione firma
  // webhook Twilio). "1" (un solo hop, non "true"/tutti) perché altrimenti
  // un client potrebbe falsificare X-Forwarded-For per aggirare il rate
  // limiting basato su IP.
  app.set("trust proxy", 1);

  // Header di sicurezza di base per la produzione (punto 32). CSP e
  // Cross-Origin-Embedder-Policy sono disattivati deliberatamente: le
  // pagine statiche (portale, verifica email, reset password) usano
  // script inline e caricano risorse cross-origin (foto firmate da
  // Supabase Storage), e una CSP di default li romperebbe senza un
  // intervento dedicato pagina per pagina — non l'oggetto di questo punto.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // Origini ammesse per le richieste browser: il dominio pubblico e, in
  // sviluppo, localhost. L'auth è Bearer JWT (mai cookie), quindi CORS non è
  // la barriera di sicurezza primaria, ma restringerlo riduce comunque la
  // superficie a siti di terze parti che riusano un token trafugato.
  const allowedOrigins = (process.env.CORS_ORIGINS || "https://www.rifless.it,https://rifless.it,https://app.rifless.it,http://localhost:3000,http://localhost:5173,http://localhost:4310")
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

  // Punto 33 (dominio e URL): struttura www.DOMINIO.it (sito commerciale,
  // sotto) / app.DOMINIO.it (gestionale, qui). Un solo servizio Express
  // serve entrambi gli host: quale contenuto rispondere dipende
  // dall'header Host della richiesta, non da un secondo deployment.
  // APP_HOSTNAME è configurabile (mai un dominio scritto a mano nel
  // codice), con default sul dominio pubblico reale.
  const appHostname = process.env.APP_HOSTNAME || "app.rifless.it";
  const frontendFile = path.join(__dirname, "..", "frontend", "carrozzeria-crm-app.html");
  app.get("/", (req, res, next) => {
    if (req.hostname !== appHostname) return next();
    res.sendFile(frontendFile);
  });

  app.use("/", express.static(path.join(__dirname, "..", "public", "home")));
  app.use("/contatti", express.static(path.join(__dirname, "..", "public", "contatti")));
  app.use("/demo", express.static(path.join(__dirname, "..", "public", "demo")));
  app.use("/faq", express.static(path.join(__dirname, "..", "public", "faq")));
  app.use("/novita", express.static(path.join(__dirname, "..", "public", "novita")));
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
  app.use("/api/super-admin", superAdminRouter);
  app.use("/api/billing/webhook", billingWebhookRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/gdpr", gdprRouter);
  app.use("/api/whatsapp/webhook", whatsappWebhookRouter);
  app.use("/api/portale", portaleRouter);
  app.use("/api/client-errors", clientErrorsRouter);
  app.use("/api/contatti", contattiRouter);
  app.use("/api/demo", demoRouter);
  app.use("/api/faq", faqRouter);
  app.use("/api/changelog", changelogRouter);
  // Punto 37 (supporto cliente): montata PRIMA del gate abbonamento come
  // auth/billing/gdpr sopra — un tenant bloccato (trial scaduto,
  // abbonamento cancellato) deve poter comunque chiedere aiuto, non solo
  // chi è già pagante.
  app.use("/api/support", supportRouter);

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
  // Punto 29 (feature entitlement): da qui in giù, le rotte delle
  // funzionalità Pro/Premium AI verificano davvero che il piano del
  // tenant le includa — vedi middleware/feature.js e PIANI in
  // lib/billing/piani.js, la fonte unica di cosa include ogni piano.
  app.use("/api/vehicles/:vehicleId/damage-assistant", requireFeature("ai_damage"), damageAssistantRouter);
  app.use("/api/damage-items", requireFeature("ai_damage"), damageItemsRouter);
  // Punto 39: oltre al gate di billing (requireFeature, "il piano lo
  // include?"), il Copilot ha anche un flag operativo — un interruttore
  // indipendente dal piano, per spegnerlo su un tenant o globalmente
  // senza toccare il codice se il provider AI ha un problema o i costi
  // vanno fuori controllo (vedi punto 41). isFeatureEnabled è fail-closed
  // (un flag mancante blocca, non lascia passare): il flag "ai_copilot_attivo"
  // va seedato attivo PRIMA che questa riga arrivi in produzione, altrimenti
  // spegnerebbe il Copilot per errore — vedi scripts/seed-feature-flags.mjs,
  // già eseguito contro il database di produzione in questo stesso commit.
  app.use("/api/copilot", requireFeature("ai_copilot"), requireFlag("ai_copilot_attivo"), copilotRouter);
  app.use("/api/vehicles/:vehicleId/insurance-gap", requireFeature("insurance_gap"), insuranceGapRouter);
  app.use("/api/insurance-gap-items", requireFeature("insurance_gap"), insuranceGapItemsRouter);
  app.use("/api/insurance-gap-suggestions", requireFeature("insurance_gap"), insuranceGapSuggestionsRouter);
  app.use("/api/whatsapp", requireFeature("whatsapp"), whatsappRouter);
  app.use("/api/profit", requireFeature("profit_tracker"), profitRouter);
  app.use("/api/delay", requireFeature("predictive_delay"), delayRouter);
  app.use("/api/parts-tracking", requireFeature("parts_tracking"), partsTrackingRouter);
  app.use("/api/photo-timeline", photoTimelineRouter);
  app.use("/api/vehicles/:vehicleId/portal-documents", requireFeature("customer_portal"), portalDocumentsRouter);
  app.use("/api/vehicles/:vehicleId/portal-actions", requireFeature("customer_portal"), portalActionsRouter);
  app.use("/api/portal-documents", requireFeature("customer_portal"), portalDocumentItemRouter);
  app.use("/api/portal-actions", requireFeature("customer_portal"), portalActionItemRouter);
  app.use("/api/vehicles/:vehicleId/work-orders", requireFeature("technician_mode"), vehicleWorkOrdersRouter);
  app.use("/api/vehicles/:vehicleId/ore-lavorate", requireFeature("technician_mode"), vehicleOreLavorateRouter);
  app.use("/api/work-orders", requireFeature("technician_mode"), workOrdersRouter);
  app.use("/api/work-order-time-entries", requireFeature("technician_mode"), workOrderTimeEntriesRouter);
  app.use("/api/live-dashboard", requireFeature("advanced_dashboard"), liveDashboardRouter);
  app.use("/api/qc/template", requireFeature("quality_control"), qcTemplateRouter);
  app.use("/api/vehicles/:vehicleId/qc", requireFeature("quality_control"), vehicleQcRouter);
  app.use("/api/qc/inspections", requireFeature("quality_control"), qcInspectionRouter);
  app.use("/api/qc/non-conformita", requireFeature("quality_control"), qcNonConformitaRouter);
  app.use("/api/loaner-cars", requireFeature("loaner_cars"), loanerCarsRouter);
  app.use("/api/supplier-orders", supplierOrdersRouter);
  app.use("/api/executive", requireFeature("advanced_dashboard"), executiveRouter);
  app.use("/api/briefing", requireFeature("morning_briefing"), briefingRouter);
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
    // Un'origine CORS rifiutata non è un errore del server: prima di
    // questo fix arrivava fin qui come qualsiasi altro errore e veniva
    // risposta 500 e loggata come un crash, mentre è solo una richiesta
    // browser bloccata correttamente (bot, scanner, o un sito di terzi
    // che riusa un token trafugato) — non deve inquinare i log/allarmi
    // di monitoraggio del punto 24 con falsi positivi.
    if (err.message === "Origine non consentita da CORS") {
      return res.status(403).json({ error: err.message });
    }
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

  return app;
}
