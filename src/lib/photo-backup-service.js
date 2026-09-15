import { supabase, PHOTOS_BUCKET, PHOTOS_BACKUP_BUCKET } from "./supabase.js";

// Backup fotografie (punto 22 del prompt SaaS): copia ogni file presente
// nel bucket principale "vehicle-photos" in un secondo bucket separato
// "vehicle-photos-backup", entrambi privati. Deliberatamente "solo
// aggiunta": se una foto viene cancellata dal bucket principale (es.
// DELETE /api/photos/:id), NON viene rimossa anche dal backup — è la
// proprietà che rende utile questo backup contro una cancellazione
// accidentale o un bug, non solo contro un guasto infrastrutturale.
// Idempotente: ogni esecuzione ricopia solo i file non ancora presenti
// nel backup, quindi può girare periodicamente senza rifare lavoro già
// fatto (i path delle foto sono generati una sola volta al caricamento
// e mai più riusati, quindi "esiste già nel backup" implica "è identico").

async function elencaRicorsivo(bucket, prefix = "") {
  const risultati = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  for (const voce of data || []) {
    const percorso = prefix ? `${prefix}/${voce.name}` : voce.name;
    // Le "cartelle" di Supabase Storage non hanno un id proprio: è la
    // convenzione ufficiale del SDK per distinguerle da un file reale.
    if (voce.id === null) {
      risultati.push(...(await elencaRicorsivo(bucket, percorso)));
    } else {
      risultati.push(percorso);
    }
  }
  return risultati;
}

export async function sincronizzaBackupFoto() {
  const [presentiOrigine, presentiBackup] = await Promise.all([
    elencaRicorsivo(PHOTOS_BUCKET),
    elencaRicorsivo(PHOTOS_BACKUP_BUCKET),
  ]);
  const giaCopiati = new Set(presentiBackup);
  const daCopiare = presentiOrigine.filter((path) => !giaCopiati.has(path));

  let copiati = 0;
  let errori = 0;
  // Concorrenza limitata: sufficiente a non impiegare troppo tempo senza
  // sovraccaricare l'API Storage con centinaia di richieste in parallelo.
  const CONCORRENZA = 4;
  let indice = 0;
  async function worker() {
    while (indice < daCopiare.length) {
      const path = daCopiare[indice++];
      try {
        const { data, error: errDownload } = await supabase.storage.from(PHOTOS_BUCKET).download(path);
        if (errDownload || !data) throw errDownload || new Error("download vuoto");
        const buffer = Buffer.from(await data.arrayBuffer());
        const { error: errUpload } = await supabase.storage
          .from(PHOTOS_BACKUP_BUCKET)
          .upload(path, buffer, { contentType: data.type || "application/octet-stream", upsert: false });
        if (errUpload) throw errUpload;
        copiati++;
      } catch (e) {
        errori++;
        console.error(`[photo-backup] copia fallita per ${path}:`, e.message || e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENZA, daCopiare.length) }, worker));

  const esito = { totaliOrigine: presentiOrigine.length, giaPresenti: giaCopiati.size, copiati, errori };
  if (daCopiare.length > 0 || errori > 0) {
    console.log("[photo-backup] sincronizzazione completata:", esito);
  }
  return esito;
}

export function startPhotoBackupWorker() {
  const run = () => sincronizzaBackupFoto().catch((e) => console.error("[photo-backup] esecuzione fallita:", e.message || e));
  run();
  // Ogni 6 ore: le foto non cambiano spesso rispetto ad altri dati, e
  // ogni esecuzione ha comunque bisogno di elencare tutto il bucket.
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
