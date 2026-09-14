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
import { portaleRouter } from "./routes/portale.js";
import { auditLogger } from "./middleware/audit.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use("/api/profit", express.json({limit:"1mb"}));
app.use("/api/photo-timeline", express.json({limit:"1mb"}));
app.use("/api/parts-tracking", express.json({limit:"1mb"}));
app.use("/api/delay", express.json({limit:"1mb"}));
app.use(express.json());
app.use(auditLogger);

if (process.env.CRM_PREVIEW === "1") app.use("/crm", express.static(path.join(__dirname, "..", "frontend")));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/portale", express.static(path.join(__dirname, "..", "public", "portale")));

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
app.use("/api/profit", profitRouter);
app.use("/api/delay", delayRouter);
app.use("/api/parts-tracking", partsTrackingRouter);
app.use("/api/photo-timeline", photoTimelineRouter);
app.use("/api/portale", portaleRouter);
app.use("/api/loaner-cars", loanerCarsRouter);
app.use("/api/supplier-orders", supplierOrdersRouter);
app.use("/api/dashboard", dashboardRouter);
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
});
