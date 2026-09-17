import { prisma } from "./prisma.js";
import { supabase, DATA_EXPORTS_BUCKET } from "./supabase.js";
import { creaNotificaRuoli } from "./notificheInApp.js";
import { inviaEmailExportPronto } from "./email.js";

// Stessa raccolta dati usata da GET /api/gdpr/export (sincrono, punto 18)
// e dal flusso asincrono qui sotto (punto 43): un'unica fonte, mai due
// implementazioni che potrebbero divergere su cosa viene esportato.
export async function costruisciExportTenant(tenantId) {
  const scope = { tenantId };
  const [tenant, users, clients, vehicles, quotes, sinistri, appointments, loanerCars] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.user.findMany({
      where: scope,
      select: { id: true, nome: true, cognome: true, email: true, ruolo: true, attivo: true, createdAt: true },
    }),
    prisma.client.findMany({
      where: scope,
      include: { documents: { select: { id: true, nome: true, createdAt: true } } },
    }),
    prisma.vehicle.findMany({ where: scope, select: { id: true, clientId: true, marca: true, modello: true, targa: true, vin: true, colore: true, dataIngresso: true, stage: true } }),
    prisma.quote.findMany({ where: scope, select: { id: true, clientId: true, vehicleId: true, stato: true, imponibile: true, aliquotaIva: true, totale: true, createdAt: true } }),
    prisma.sinistro.findMany({ where: scope, select: { id: true, clientId: true, vehicleId: true, numeroPratica: true, compagniaAssicurativa: true, stato: true, createdAt: true } }),
    prisma.appointment.findMany({ where: scope, select: { id: true, clientId: true, vehicleId: true, titolo: true, inizio: true, fine: true, tipo: true } }),
    prisma.loanerCar.findMany({ where: scope, select: { id: true, targa: true, marca: true, modello: true } }),
  ]);

  return {
    generatoIl: new Date().toISOString(),
    tenant: tenant ? { id: tenant.id, ragioneSociale: tenant.ragioneSociale, partitaIva: tenant.partitaIva, createdAt: tenant.createdAt } : null,
    utenti: users,
    clienti: clients,
    veicoli: vehicles,
    preventivi: quotes,
    sinistri,
    appuntamenti: appointments,
    autoSostitutive: loanerCars,
    nota: "Export dei dati operativi principali. Foto e documenti binari non sono inclusi inline (solo i loro metadati): sono disponibili tramite le rispettive route autenticate del gestionale.",
  };
}

// Quanto resta valido il file su Storage prima che il link diventi
// definitivamente inutilizzabile (non solo la singola firma, il file
// stesso — vedi il worker di pulizia più sotto).
const SCADENZA_EXPORT_ORE = 48;
// Il link "temporaneo" richiesto dal punto 43 è una URL firmata di
// Supabase Storage: mai permanente, rigenerata a ogni download (vedi
// generaLinkScaricamento). 5 minuti bastano a completare un download
// avviato subito dopo la chiamata, senza restare valida a lungo.
const TTL_LINK_DOWNLOAD_SEC = 5 * 60;

async function eseguiExport(requestId, tenantId) {
  try {
    const dati = await costruisciExportTenant(tenantId);
    const path = `${tenantId}/${requestId}.json`;
    const { error } = await supabase.storage.from(DATA_EXPORTS_BUCKET).upload(path, JSON.stringify(dati, null, 2), {
      contentType: "application/json",
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const scadenza = new Date(Date.now() + SCADENZA_EXPORT_ORE * 60 * 60 * 1000);
    const richiesta = await prisma.dataExportRequest.update({
      where: { id: requestId },
      data: { stato: "PRONTO", storagePath: path, scadenza, completatoAt: new Date() },
      include: { richiedente: { select: { nome: true, email: true } } },
    });

    creaNotificaRuoli({
      tenantId,
      ruoli: ["ADMIN"],
      categoria: "SISTEMA",
      titolo: "Export dati pronto",
      messaggio: "L'export dei dati della carrozzeria è pronto per il download, dalla sezione Privacy e dati.",
    }).catch((err) => console.error("[data-export] Notifica in-app fallita:", err.message));

    inviaEmailExportPronto({ email: richiesta.richiedente.email, nome: richiesta.richiedente.nome, tenantId }).catch((err) =>
      console.error("[data-export] Email notifica fallita:", err.message)
    );
  } catch (err) {
    console.error(`[data-export] Export ${requestId} fallito:`, err.message);
    await prisma.dataExportRequest.update({
      where: { id: requestId },
      data: { stato: "FALLITO", erroreMessaggio: err.message.slice(0, 500) },
    }).catch(() => {});
  }
}

// Punto 43: "Export asincrono sicuro" — la richiesta torna SUBITO (la
// riga IN_CORSO), la costruzione vera e propria (può includere migliaia
// di righe) gira in background senza tenere la richiesta HTTP aperta.
export async function avviaExportAsincrono({ tenantId, richiedenteId }) {
  const richiesta = await prisma.dataExportRequest.create({
    data: { tenantId, richiedenteId },
  });
  eseguiExport(richiesta.id, tenantId).catch((err) => console.error("[data-export] Errore imprevisto:", err.message));
  return richiesta;
}

// Link temporaneo e protetto (punto 43): mai il path di storage esposto
// direttamente, sempre una URL firmata rigenerata al momento del
// download, mai salvata — stesso principio già usato per le foto
// (punto 19, lib/photo-timeline.js).
// "Temporaneo" per davvero: oltre a rifiutare nuove firme dopo la
// scadenza (generaLinkScaricamento sopra), il file viene rimosso
// fisicamente dallo Storage — un export coi dati di ogni cliente non
// deve restare a tempo indeterminato solo perché nessuno lo ha
// riscaricato in tempo.
export async function pulisciExportScaduti() {
  const scaduti = await prisma.dataExportRequest.findMany({
    where: { stato: "PRONTO", storagePath: { not: null }, scadenza: { lt: new Date() } },
    select: { id: true, storagePath: true },
  });
  if (!scaduti.length) return { rimossi: 0 };

  const { error } = await supabase.storage.from(DATA_EXPORTS_BUCKET).remove(scaduti.map((r) => r.storagePath));
  if (error) {
    console.error("[data-export] Pulizia export scaduti fallita:", error.message);
    return { rimossi: 0, errore: error.message };
  }

  await prisma.dataExportRequest.updateMany({
    where: { id: { in: scaduti.map((r) => r.id) } },
    data: { storagePath: null },
  });
  console.log(`[data-export] Rimossi ${scaduti.length} export scaduti dallo Storage.`);
  return { rimossi: scaduti.length };
}

export function startDataExportCleanupWorker() {
  const run = () => pulisciExportScaduti().catch((e) => console.error("[data-export] esecuzione pulizia fallita:", e.message || e));
  run();
  // Ogni 6 ore, stesso ritmo del backup foto: non serve una precisione
  // al minuto per un file che comunque non è più scaricabile dopo la
  // scadenza (generaLinkScaricamento la rispetta già indipendentemente).
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

export async function generaLinkScaricamento(richiesta) {
  if (richiesta.stato !== "PRONTO" || !richiesta.storagePath) return null;
  if (richiesta.scadenza && richiesta.scadenza < new Date()) return null;
  const { data, error } = await supabase.storage.from(DATA_EXPORTS_BUCKET).createSignedUrl(richiesta.storagePath, TTL_LINK_DOWNLOAD_SEC);
  if (error) {
    console.error("[data-export] Firma URL fallita:", error.message);
    return null;
  }
  return data.signedUrl;
}
