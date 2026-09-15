import { prisma } from "./prisma.js";

// Punto 24 (monitoring): un /health che risponde sempre "ok" a prescindere
// non serve a molto a un uptime monitor — qui verifichiamo davvero la
// dipendenza più critica (il database) con una query minima e veloce, e
// segnaliamo lo stato di configurazione delle altre dipendenze esterne
// (storage, email, AI, pagamenti, WhatsApp) senza contattarle a ogni
// controllo: un health endpoint colpito ogni minuto da un monitor esterno
// non deve diventare lui stesso un carico extra su servizi terzi a
// pagamento (es. chiamate Anthropic/Stripe fatturate a consumo).
export async function statoSalute() {
  const inizio = Date.now();
  let database = { ok: false, latenzaMs: null };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, latenzaMs: Date.now() - inizio };
  } catch (e) {
    database = { ok: false, latenzaMs: null, errore: e.message };
  }

  const configurato = (chiave) => Boolean(process.env[chiave]);

  const dipendenze = {
    database,
    storageFoto: { configurato: configurato("SUPABASE_URL") && configurato("SUPABASE_SERVICE_ROLE_KEY") },
    email: { configurato: configurato("RESEND_API_KEY") },
    whatsapp: { configurato: configurato("TWILIO_ACCOUNT_SID") && configurato("TWILIO_AUTH_TOKEN") },
    pagamenti: { configurato: configurato("STRIPE_SECRET_KEY") },
    ai: { configurato: configurato("ANTHROPIC_API_KEY") },
  };

  const worker = (nome, envVar) => ({ attivo: process.env[envVar] !== "0", nome });
  const workers = [
    worker("Predictive Delay", "DELAY_WORKER"),
    worker("Morning Briefing", "BRIEFING_WORKER"),
    worker("Backup foto", "PHOTO_BACKUP_WORKER"),
  ];

  return {
    ok: database.ok,
    timestamp: new Date().toISOString(),
    manutenzione: process.env.MAINTENANCE_MODE === "1",
    dipendenze,
    workers,
  };
}
