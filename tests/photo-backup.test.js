// Punto 22 (backup): verifica reale contro Supabase che sincronizzaBackupFoto
// copia davvero i file nel bucket di backup, è idempotente (non ricopia
// due volte) e NON cancella dal backup una foto rimossa dall'origine.

import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";

const { supabase, PHOTOS_BUCKET, PHOTOS_BACKUP_BUCKET } = await import("../src/lib/supabase.js");
const { sincronizzaBackupFoto } = await import("../src/lib/photo-backup-service.js");

test("Backup foto: copia, idempotenza, e sopravvivenza a una cancellazione dall'origine", async () => {
  const suffix = Date.now();
  const path = `zzz-test-backup/${suffix}/foto.jpg`;
  const contenuto = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // JPEG minimale

  try {
    const { error: errUpload } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, contenuto, { contentType: "image/jpeg" });
    assert.equal(errUpload, null);

    const esito1 = await sincronizzaBackupFoto();
    assert.ok(esito1.copiati >= 1, "la nuova foto deve essere stata copiata");

    const { data: nelBackup, error: errDownload } = await supabase.storage.from(PHOTOS_BACKUP_BUCKET).download(path);
    assert.equal(errDownload, null);
    const buffer = Buffer.from(await nelBackup.arrayBuffer());
    assert.deepEqual(buffer, contenuto, "il contenuto copiato deve essere identico all'originale");

    const esito2 = await sincronizzaBackupFoto();
    assert.equal(esito2.copiati, 0, "una seconda esecuzione non deve ricopiare nulla (idempotenza)");
    assert.ok(esito2.giaPresenti >= 1);

    // Cancellazione dall'origine: la copia nel backup deve restare.
    const { error: errRemove } = await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
    assert.equal(errRemove, null);

    const { data: ancoraPresente, error: errRicontrollo } = await supabase.storage.from(PHOTOS_BACKUP_BUCKET).download(path);
    assert.equal(errRicontrollo, null, "la copia nel backup deve sopravvivere alla cancellazione dell'originale");
    assert.ok(ancoraPresente);
  } finally {
    await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
    await supabase.storage.from(PHOTOS_BACKUP_BUCKET).remove([path]);
  }
});
