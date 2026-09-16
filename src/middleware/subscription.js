import { prisma } from "../lib/prisma.js";
import { tenantIdOpzionale } from "./auth.js";

// Stati che indicano esplicitamente "non pagante" secondo Stripe (vedi
// statoDaStripe in lib/billing/piani.js): un abbonamento cancellato,
// con pagamento fallito in modo definitivo, o sospeso manualmente.
const STATI_BLOCCANTI = new Set(["CANCELED", "UNPAID", "SUSPENDED"]);

// Punto 23 del prompt SaaS ("subscription required"): senza questo
// controllo un tenant in prova potrebbe continuare a usare il
// gestionale gratuitamente per sempre anche dopo la scadenza del
// trial, vanificando l'intero modulo di fatturazione (punto 6).
//
// Montato SOLO sulle rotte operative: billing, auth e le richieste
// GDPR restano sempre raggiungibili, altrimenti un tenant bloccato non
// potrebbe né pagare per riattivarsi né esportare/cancellare i propri
// dati — vedi le esclusioni in index.js.
export async function requireAbbonamentoAttivo(req, res, next) {
  const tenantId = tenantIdOpzionale(req);
  // Nessun token valido: lascia che sia requireAuth, più a valle nella
  // stessa rotta, a rispondere 401 nel modo consueto.
  if (!tenantId) return next();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { subscriptionStatus: true, piano: true, trialEndsAt: true, isDemo: true },
  });
  if (!tenant) return next();
  // Un tenant demo (punto 28) non ha un vero abbonamento e non deve mai
  // interrompersi: non ha senso bloccarlo per "trial scaduto".
  if (tenant.isDemo) return next();

  const trialScaduto = tenant.piano === "TRIAL" && tenant.subscriptionStatus === "TRIALING" && tenant.trialEndsAt && tenant.trialEndsAt < new Date();
  const bloccato = STATI_BLOCCANTI.has(tenant.subscriptionStatus) || trialScaduto;

  if (bloccato) {
    return res.status(402).json({
      error: trialScaduto
        ? "Il periodo di prova è scaduto. Attiva un piano per continuare a usare Rifless."
        : "Abbonamento non attivo. Verifica lo stato del pagamento per continuare a usare Rifless.",
      subscriptionRequired: true,
      subscriptionStatus: tenant.subscriptionStatus,
    });
  }
  next();
}
