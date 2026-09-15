import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maintenancePage = fs.readFileSync(path.join(__dirname, "..", "..", "public", "maintenance", "index.html"), "utf8");

// Punto 23 del prompt SaaS ("pagina maintenance"): con MAINTENANCE_MODE="1"
// ogni richiesta (tranne /health, che deve restare raggiungibile per il
// monitoring esterno) riceve una risposta 503 invece di essere elaborata
// normalmente — pagina HTML per il browser, JSON per l'API.
export function maintenanceMode(req, res, next) {
  if (process.env.MAINTENANCE_MODE !== "1" || req.path === "/health") return next();

  res.set("Retry-After", "600");
  if (req.path.startsWith("/api/")) {
    return res.status(503).json({ error: "Rifless è temporaneamente in manutenzione. Riprova tra qualche minuto." });
  }
  res.status(503).type("html").send(maintenancePage);
}
