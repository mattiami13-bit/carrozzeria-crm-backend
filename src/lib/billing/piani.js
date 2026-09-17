// Configurazione commerciale centralizzata: piani, prezzi, feature
// entitlement, add-on. Un solo posto da cambiare invece di logica sparsa
// in decine di componenti (punto 3 del prompt SaaS).
//
// I prezzi qui sono quelli "ufficiali" comunicati dal titolare del
// prodotto. Gli Stripe Price ID NON sono hardcoded: ogni piano punta al
// NOME di una variabile d'ambiente che deve contenere il vero Price ID
// creato su Stripe — così i prezzi restano modificabili senza toccare
// codice, e nessuna chiave/id sensibile finisce nel repository.

export const PIANI = {
  STARTER: {
    key: "STARTER",
    nome: "Starter",
    descrizione: "Pensato per piccole carrozzerie.",
    prezzoMensileCents: 7900,
    prezzoAnnualeCents: 79000,
    utentiInclusi: 3,
    sediIncluse: 1,
    stripePriceEnvMensile: "STRIPE_PRICE_STARTER_MENSILE",
    stripePriceEnvAnnuale: "STRIPE_PRICE_STARTER_ANNUALE",
    aiCreditiInclusiMensili: 0,
    evidenziato: false,
    features: {
      clients: true, vehicles: true, jobs: true, estimates: true, calendar: true,
      photos: true, documents: true, appointments: true, dashboard_base: true,
      report_essenziali: true,
      parts_tracking: false, technician_mode: false, loaner_cars: false,
      quality_control: false, customer_portal: false, profit_tracker: false,
      advanced_dashboard: false, whatsapp: false, automazioni: false,
      ai_copilot: false, ai_damage: false, insurance_gap: false,
      predictive_delay: false, morning_briefing: false,
    },
  },
  PRO: {
    key: "PRO",
    nome: "Pro",
    descrizione: "Il piano più scelto: equilibrio tra prezzo e funzionalità operative avanzate.",
    prezzoMensileCents: 14900,
    prezzoAnnualeCents: 149000,
    utentiInclusi: 10,
    sediIncluse: 1,
    stripePriceEnvMensile: "STRIPE_PRICE_PRO_MENSILE",
    stripePriceEnvAnnuale: "STRIPE_PRICE_PRO_ANNUALE",
    aiCreditiInclusiMensili: 0,
    evidenziato: true,
    badge: "PIÙ SCELTO",
    features: {
      clients: true, vehicles: true, jobs: true, estimates: true, calendar: true,
      photos: true, documents: true, appointments: true, dashboard_base: true,
      report_essenziali: true,
      parts_tracking: true, technician_mode: true, loaner_cars: true,
      quality_control: true, customer_portal: true, profit_tracker: true,
      advanced_dashboard: true, whatsapp: true, automazioni: true,
      ai_copilot: false, ai_damage: false, insurance_gap: false,
      predictive_delay: false, morning_briefing: false,
    },
  },
  PREMIUM_AI: {
    key: "PREMIUM_AI",
    nome: "Premium AI",
    descrizione: "Per carrozzerie strutturate e ad alto volume: tutto Pro più l'intera suite AI.",
    prezzoMensileCents: 24900,
    prezzoAnnualeCents: 249000,
    utentiInclusi: 20,
    sediIncluse: 1,
    stripePriceEnvMensile: "STRIPE_PRICE_PREMIUM_AI_MENSILE",
    stripePriceEnvAnnuale: "STRIPE_PRICE_PREMIUM_AI_ANNUALE",
    aiCreditiInclusiMensili: 1000,
    evidenziato: false,
    features: {
      clients: true, vehicles: true, jobs: true, estimates: true, calendar: true,
      photos: true, documents: true, appointments: true, dashboard_base: true,
      report_essenziali: true,
      parts_tracking: true, technician_mode: true, loaner_cars: true,
      quality_control: true, customer_portal: true, profit_tracker: true,
      advanced_dashboard: true, whatsapp: true, automazioni: true,
      ai_copilot: true, ai_damage: true, insurance_gap: true,
      predictive_delay: true, morning_briefing: true,
    },
  },
};

// TRIAL non è un piano acquistabile: è uno stato temporaneo. Finché dura,
// un tenant ha le entitlement del piano consigliato in prova. Nessun
// codice legge oggi questa costante (la durata reale è calcolata
// direttamente in routes/auth.js alla registrazione): tenuta allineata
// qui comunque, trovata disallineata (diceva 14 invece di 30) durante
// la verifica delle risposte reali per la FAQ del punto 36.
export const TRIAL_GIORNI = 30;
export const TRIAL_PIANO = "PRO";

export const SETUP_FEE_CENTS = 19900;
export const UTENTE_EXTRA_MENSILE_CENTS = 1500;
export const STRIPE_PRICE_ENV_UTENTE_EXTRA = "STRIPE_PRICE_UTENTE_EXTRA";
export const AI_CREDITI_PACK = { crediti: 500, prezzoCents: 2900, stripePriceEnv: "STRIPE_PRICE_AI_CREDITI_PACK" };

export const EARLY_ADOPTER = {
  piano: "PRO",
  prezzoMensileCents: 9900,
  mesiDurata: 12,
  maxRedemption: 30,
  stripePriceEnv: "STRIPE_PRICE_EARLY_ADOPTER_PRO",
};

// true/false per ogni feature secondo il piano ATTUALE del tenant.
// Durante il trial si applicano le entitlement del TRIAL_PIANO.
export function featuresPerPiano(piano) {
  const chiave = piano === "TRIAL" ? TRIAL_PIANO : piano;
  return PIANI[chiave]?.features ?? PIANI.STARTER.features;
}

export function haFeature(tenant, featureKey) {
  const features = featuresPerPiano(tenant.piano);
  return Boolean(features[featureKey]);
}

// Risolve il vero Stripe Price ID dalla variabile d'ambiente associata al
// piano scelto. Ritorna null (mai un errore che espone dettagli interni)
// se la variabile non è configurata: il chiamante decide come reagire.
export function stripePriceId(pianoKey, periodicita) {
  const piano = PIANI[pianoKey];
  if (!piano) return null;
  const envName = periodicita === "ANNUALE" ? piano.stripePriceEnvAnnuale : piano.stripePriceEnvMensile;
  return process.env[envName] || null;
}

// Percorso inverso: da un Price ID Stripe (letto da un webhook, es. dopo
// un cambio piano fatto dal Customer Portal) risale a quale piano/
// periodicità rappresenta, confrontandolo con gli ID configurati nelle
// variabili d'ambiente. Include anche il prezzo Early Adopter, che vale
// come "PRO mensile" a tutti gli effetti di entitlement.
export function pianoDaPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env[EARLY_ADOPTER.stripePriceEnv]) {
    return { piano: EARLY_ADOPTER.piano, periodicita: "MENSILE" };
  }
  for (const piano of Object.values(PIANI)) {
    if (priceId === process.env[piano.stripePriceEnvMensile]) return { piano: piano.key, periodicita: "MENSILE" };
    if (priceId === process.env[piano.stripePriceEnvAnnuale]) return { piano: piano.key, periodicita: "ANNUALE" };
  }
  return null;
}

// Mappa lo stato Stripe (stringa) al nostro enum SubscriptionStatus. Gli
// stati che Stripe non usa esplicitamente (SUSPENDED) restano una
// decisione manuale/futura (es. da un pannello super-admin), non
// qualcosa che Stripe comunica da solo.
export function statoDaStripe(stripeStatus) {
  const mappa = {
    trialing: "TRIALING",
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID",
    incomplete: "INCOMPLETE",
    incomplete_expired: "CANCELED",
    paused: "SUSPENDED",
  };
  return mappa[stripeStatus] || "INCOMPLETE";
}
