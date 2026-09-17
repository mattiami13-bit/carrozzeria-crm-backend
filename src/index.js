import "dotenv/config";
import { buildApp } from "./app.js";
import { startBriefingWorker } from './lib/briefing-service.js';
import { startPhotoBackupWorker } from './lib/photo-backup-service.js';
import { startDataExportCleanupWorker } from './lib/dataExport.js';
import { startDelayWorker } from "./lib/delay-service.js";

// Fail-fast: senza un JWT_SECRET robusto, jsonwebtoken firmerebbe/verificherebbe
// comunque i token (con un valore undefined o debole), esponendo un rischio di
// forgery scoperto solo in produzione. Meglio non avviarsi affatto.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET mancante o troppo corto (minimo 32 caratteri): impostalo nelle variabili d'ambiente prima di avviare il server.");
  process.exit(1);
}

// Entrypoint sottile: la costruzione dell'app vive in src/app.js (punto
// 47, "test end-to-end reale") — qui solo avvio del server e dei worker
// in background, mai logica di routing/middleware.
const app = buildApp();

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`API in ascolto su http://localhost:${port}`);
  if (process.env.DELAY_WORKER !== "0") startDelayWorker();
  if (process.env.BRIEFING_WORKER !== "0") startBriefingWorker();
  if (process.env.PHOTO_BACKUP_WORKER !== "0") startPhotoBackupWorker();
  if (process.env.DATA_EXPORT_CLEANUP_WORKER !== "0") startDataExportCleanupWorker();
});
