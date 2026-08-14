import "dotenv/config";
import express from "express";
import cors from "cors";

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

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/parts", partsRouter);
app.use("/api/sinistri", sinistriRouter);
app.use("/api/assistente", assistenteRouter);
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
});
