// Punto 43 (export dati asincrono): crea il bucket Supabase Storage
// privato usato per gli export, se non esiste già. Idempotente, sicuro
// da rieseguire (non tocca nulla se il bucket c'è già).
import "dotenv/config";
import { supabase, DATA_EXPORTS_BUCKET } from "../src/lib/supabase.js";

async function main() {
  const { data: esistenti, error: errListing } = await supabase.storage.listBuckets();
  if (errListing) throw new Error(errListing.message);

  if (esistenti.some((b) => b.name === DATA_EXPORTS_BUCKET)) {
    console.log(`Bucket "${DATA_EXPORTS_BUCKET}" già esistente: nessuna modifica.`);
    return;
  }

  const { error } = await supabase.storage.createBucket(DATA_EXPORTS_BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ["application/json"],
  });
  if (error) throw new Error(error.message);
  console.log(`Bucket "${DATA_EXPORTS_BUCKET}" creato (privato, solo JSON, max 20MB per file).`);
}

main().catch((err) => {
  console.error("Errore:", err.message);
  process.exitCode = 1;
});
