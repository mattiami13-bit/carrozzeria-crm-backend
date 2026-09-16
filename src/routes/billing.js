import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { stripe, stripeConfigurato } from "../lib/stripe.js";
import { creaNotificaRuoli } from "../lib/notificheInApp.js";
import {
  PIANI, SETUP_FEE_CENTS, UTENTE_EXTRA_MENSILE_CENTS, AI_CREDITI_PACK, EARLY_ADOPTER,
  stripePriceId, pianoDaPriceId, statoDaStripe,
} from "../lib/billing/piani.js";

export const billingRouter = Router();

// Dalle API Stripe più recenti (2025+), il fine periodo non è più sulla
// subscription stessa ma sul suo primo item — vale per abbonamenti con
// una sola riga come i nostri.
function finePeriodo(subscription) {
  const secs = subscription.items?.data?.[0]?.current_period_end;
  return secs ? new Date(secs * 1000) : null;
}

// Il webhook usa la firma sul BODY GREZZO (raw), quindi la sua route va
// montata PRIMA di express.json() globale — vedi src/index.js, dove
// riceve express.raw() dedicato solo per questo percorso.
export const billingWebhookRouter = Router();

async function postiEarlyAdopterRimasti() {
  const usati = await prisma.tenant.count({ where: { earlyAdopter: true } });
  return Math.max(0, EARLY_ADOPTER.maxRedemption - usati);
}

// GET /api/billing/piani — pubblico (non richiede login): serve alla
// pagina prezzi per mostrare piani/prezzi senza duplicare la
// configurazione lato frontend.
billingRouter.get("/piani", async (req, res) => {
  const posti = await postiEarlyAdopterRimasti();
  res.json({
    piani: Object.values(PIANI).map((p) => ({
      key: p.key, nome: p.nome, descrizione: p.descrizione,
      prezzoMensileCents: p.prezzoMensileCents, prezzoAnnualeCents: p.prezzoAnnualeCents,
      utentiInclusi: p.utentiInclusi, evidenziato: p.evidenziato, badge: p.badge || null,
      features: p.features,
    })),
    setupFeeCents: SETUP_FEE_CENTS,
    utenteExtraMensileCents: UTENTE_EXTRA_MENSILE_CENTS,
    aiCreditiPack: AI_CREDITI_PACK,
    earlyAdopter: { ...EARLY_ADOPTER, postiRimasti: posti },
  });
});

billingRouter.use(requireAuth);

billingRouter.get("/stato", requireRole("ADMIN", "AMMINISTRAZIONE"), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Organizzazione non trovata" });

  const utentiUsati = await prisma.user.count({ where: { tenantId: tenant.id, attivo: true } });
  const piano = PIANI[tenant.piano] || null;

  res.json({
    piano: tenant.piano,
    subscriptionStatus: tenant.subscriptionStatus,
    fatturazionePeriodicita: tenant.fatturazionePeriodicita,
    currentPeriodEnd: tenant.currentPeriodEnd,
    cancelAtPeriodEnd: tenant.cancelAtPeriodEnd,
    trialEndsAt: tenant.trialEndsAt,
    earlyAdopter: tenant.earlyAdopter,
    utentiInclusi: piano ? piano.utentiInclusi + tenant.utentiExtra : null,
    utentiUsati,
    creditiAIAcquistati: tenant.creditiAIAcquistati,
    hasStripeCustomer: Boolean(tenant.stripeCustomerId),
    stripeConfigurato: stripeConfigurato(),
  });
});

const checkoutSchema = z.object({
  piano: z.enum(["STARTER", "PRO", "PREMIUM_AI"]),
  periodicita: z.enum(["MENSILE", "ANNUALE"]).default("MENSILE"),
  earlyAdopter: z.boolean().optional(),
});

// POST /api/billing/checkout — crea una Stripe Checkout Session per
// attivare/cambiare abbonamento. NON gestisce mai direttamente numeri di
// carta: Stripe Checkout è una pagina ospitata da Stripe stesso.
billingRouter.post("/checkout", requireRole("ADMIN"), async (req, res) => {
  if (!stripeConfigurato()) {
    return res.status(501).json({ error: "Pagamenti non ancora configurati. Contatta l'amministratore della piattaforma." });
  }
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { piano, periodicita, earlyAdopter } = parsed.data;

  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Organizzazione non trovata" });

  // Blocco downgrade (e in generale ogni cambio piano) se gli utenti
  // attivi superano quelli inclusi nel piano di destinazione: attivarlo
  // lascerebbe il tenant con più utenti di quanti il piano ne preveda,
  // senza un modo pulito per capire chi disattivare automaticamente.
  if (tenant.piano !== piano) {
    const pianoNuovo = PIANI[piano];
    const utentiUsati = await prisma.user.count({ where: { tenantId: tenant.id, attivo: true } });
    const utentiInclusiNuovoPiano = pianoNuovo.utentiInclusi + tenant.utentiExtra;
    if (utentiUsati > utentiInclusiNuovoPiano) {
      return res.status(409).json({
        error: `Il piano ${pianoNuovo.nome} include ${utentiInclusiNuovoPiano} utenti, ma ne hai ${utentiUsati} attivi. Disattiva gli utenti in eccesso prima di cambiare piano.`,
        utentiUsati,
        utentiInclusi: utentiInclusiNuovoPiano,
      });
    }
  }

  let priceId;
  let earlyAdopterApplicato = false;
  if (earlyAdopter) {
    if (piano !== EARLY_ADOPTER.piano || periodicita !== "MENSILE") {
      return res.status(400).json({ error: "La promozione Early Adopter è disponibile solo per il piano PRO mensile" });
    }
    const posti = await postiEarlyAdopterRimasti();
    if (posti <= 0) return res.status(409).json({ error: "La promozione Early Adopter ha esaurito i posti disponibili" });
    priceId = process.env[EARLY_ADOPTER.stripePriceEnv] || null;
    earlyAdopterApplicato = true;
  } else {
    priceId = stripePriceId(piano, periodicita);
  }

  if (!priceId) {
    return res.status(501).json({
      error: `Prezzo non configurato per ${piano} ${periodicita}. Manca la variabile d'ambiente su Railway con il Price ID Stripe corrispondente.`,
    });
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const lineItems = [{ price: priceId, quantity: 1 }];

  // Il costo di attivazione si applica solo a chi non ha mai avuto un
  // cliente Stripe collegato (cioè non ha mai completato un checkout
  // prima d'ora), coerente con "applicato solo a nuovi clienti" — MA
  // è sempre gratuito per la promo Early Adopter, parte dell'offerta.
  const setupFeePriceId = process.env.STRIPE_PRICE_SETUP_FEE;
  if (!tenant.stripeCustomerId && setupFeePriceId && !earlyAdopterApplicato) {
    lineItems.push({ price: setupFeePriceId, quantity: 1 });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      customer: tenant.stripeCustomerId || undefined,
      client_reference_id: tenant.id,
      success_url: `${baseUrl}/billing/successo?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing/annullato`,
      subscription_data: {
        metadata: { tenantId: tenant.id, piano, periodicita, earlyAdopter: String(earlyAdopterApplicato) },
      },
      metadata: { tenantId: tenant.id, piano, periodicita, earlyAdopter: String(earlyAdopterApplicato) },
      // Managed Payments di Stripe richiederebbe un tax_code su ogni
      // prodotto per calcolare l'imposta automaticamente; i nostri prezzi
      // sono già mostrati "IVA esclusa" e gestiti a parte, quindi lo
      // disattiviamo su queste sessioni invece di configurare tax_code
      // su 9 prodotti per una funzione che non usiamo ancora.
      managed_payments: { enabled: false },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("[billing] Errore creazione checkout session:", err.message);
    res.status(502).json({ error: "Errore nella comunicazione con Stripe. Riprova tra qualche istante." });
  }
});

// POST /api/billing/crediti-ai — acquisto una tantum di un pacchetto di
// crediti AI aggiuntivi (mode "payment", non un abbonamento: si paga una
// volta sola, i crediti si sommano a quelli già disponibili, non scadono
// a fine mese). Richiede che il tenant abbia già un cliente Stripe (cioè
// un piano attivo): non ha senso comprare crediti AI senza un abbonamento.
billingRouter.post("/crediti-ai", requireRole("ADMIN"), async (req, res) => {
  if (!stripeConfigurato()) {
    return res.status(501).json({ error: "Pagamenti non ancora configurati." });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Organizzazione non trovata" });
  if (!tenant.stripeCustomerId) {
    return res.status(400).json({ error: "Attiva prima un piano: i crediti AI si aggiungono a un abbonamento esistente." });
  }

  const priceId = process.env[AI_CREDITI_PACK.stripePriceEnv];
  if (!priceId) {
    return res.status(501).json({ error: "Prezzo del pacchetto crediti AI non configurato. Manca la variabile d'ambiente su Railway." });
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: tenant.stripeCustomerId,
      success_url: `${baseUrl}/billing/successo?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing/annullato`,
      metadata: { tenantId: tenant.id, tipo: "crediti_ai", crediti: String(AI_CREDITI_PACK.crediti) },
      managed_payments: { enabled: false },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("[billing] Errore creazione checkout crediti AI:", err.message);
    res.status(502).json({ error: "Errore nella comunicazione con Stripe. Riprova tra qualche istante." });
  }
});

// POST /api/billing/portal — Stripe Customer Portal: gestione autonoma di
// metodo di pagamento, fatture, cancellazione. Richiede che il tenant
// abbia già un customer Stripe (cioè abbia completato almeno un checkout).
billingRouter.post("/portal", requireRole("ADMIN"), async (req, res) => {
  if (!stripeConfigurato()) {
    return res.status(501).json({ error: "Pagamenti non ancora configurati." });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  if (!tenant?.stripeCustomerId) {
    return res.status(400).json({ error: "Nessun abbonamento attivo: attiva prima un piano." });
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${baseUrl}/billing/successo`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("[billing] Errore creazione portal session:", err.message);
    res.status(502).json({ error: "Errore nella comunicazione con Stripe. Riprova tra qualche istante." });
  }
});

// --------------------------------------------------------------------
// WEBHOOK
// --------------------------------------------------------------------

billingWebhookRouter.post("/", async (req, res) => {
  if (!stripeConfigurato() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(501).json({ error: "Webhook Stripe non configurato" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[billing] Firma webhook non valida:", err.message);
    return res.status(400).json({ error: "Firma non valida" });
  }

  // Idempotenza: Stripe può consegnare lo stesso evento più volte
  // ("at least once delivery"). L'id evento Stripe è la chiave primaria:
  // un secondo tentativo urta contro il vincolo di unicità e si ferma
  // qui, PRIMA di riapplicare l'effetto una seconda volta.
  try {
    await prisma.stripeWebhookEvent.create({ data: { id: event.id, tipo: event.type } });
  } catch (err) {
    console.log(`[billing] Evento ${event.id} già elaborato, ignorato (idempotenza)`);
    return res.json({ ok: true, duplicato: true });
  }

  try {
    await gestisciEvento(event);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[billing] Errore elaborazione evento ${event.type} (${event.id}):`, err);
    // 500 così Stripe ritenta: l'evento è già segnato come "visto" sopra,
    // quindi se il retry arriva DOPO che l'errore è stato risolto va
    // comunque perso — accettabile per ora, da irrobustire con una coda
    // dedicata se il volume di errori reali lo giustificherà.
    res.status(500).json({ error: "Errore interno" });
  }
});

async function gestisciEvento(event) {
  switch (event.type) {
    case "checkout.session.completed":
      return gestisciCheckoutCompletato(event.data.object);
    case "customer.subscription.updated":
      return gestisciSubscriptionAggiornata(event.data.object);
    case "customer.subscription.deleted":
      return gestisciSubscriptionCancellata(event.data.object);
    case "invoice.payment_failed":
      return gestisciPagamentoFallito(event.data.object);
    case "invoice.paid":
      return gestisciPagamentoRiuscito(event.data.object);
    default:
      console.log(`[billing] Evento ${event.type} ricevuto, nessun handler dedicato (ignorato volutamente)`);
  }
}

async function gestisciCheckoutCompletato(session) {
  const tenantId = session.metadata?.tenantId || session.client_reference_id;
  if (!tenantId) {
    console.warn("[billing] checkout.session.completed senza tenantId nei metadata, ignorato");
    return;
  }

  // Acquisto una tantum di crediti AI (mode "payment", non un
  // abbonamento): si somma ai crediti già presenti, non tocca piano o
  // stato dell'abbonamento.
  if (session.metadata?.tipo === "crediti_ai") {
    const crediti = Number(session.metadata.crediti) || 0;
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { creditiAIAcquistati: { increment: crediti } },
    });
    creaNotificaRuoli({
      tenantId, ruoli: ["ADMIN"], categoria: "PAGAMENTI",
      titolo: "Crediti AI acquistati", messaggio: `${crediti} crediti AI aggiunti al tuo account.`,
    }).catch((err) => console.error("[billing] Errore notifica crediti AI:", err.message));
    return;
  }

  if (session.mode !== "subscription" || !session.subscription) return;

  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const piano = session.metadata?.piano;
  const periodicita = session.metadata?.periodicita;
  const earlyAdopterRichiesto = session.metadata?.earlyAdopter === "true";

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      stripeCustomerId: String(session.customer),
      stripeSubscriptionId: subscription.id,
      piano: piano || undefined,
      fatturazionePeriodicita: periodicita || undefined,
      subscriptionStatus: statoDaStripe(subscription.status),
      currentPeriodEnd: finePeriodo(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      earlyAdopter: earlyAdopterRichiesto || undefined,
    },
  });

  creaNotificaRuoli({
    tenantId, ruoli: ["ADMIN"], categoria: "PAGAMENTI",
    titolo: "Pagamento riuscito", messaggio: `Il piano ${piano || ""} è stato attivato con successo.`,
  }).catch((err) => console.error("[billing] Errore notifica pagamento riuscito:", err.message));
}

async function trovaTenantDaSubscription(subscription) {
  return prisma.tenant.findFirst({
    where: { OR: [{ stripeSubscriptionId: subscription.id }, { stripeCustomerId: String(subscription.customer) }] },
  });
}

async function gestisciSubscriptionAggiornata(subscription) {
  const tenant = await trovaTenantDaSubscription(subscription);
  if (!tenant) {
    console.warn(`[billing] customer.subscription.updated per un customer/subscription sconosciuto: ${subscription.id}`);
    return;
  }

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const risolto = pianoDaPriceId(priceId);

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: statoDaStripe(subscription.status),
      currentPeriodEnd: finePeriodo(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      ...(risolto ? { piano: risolto.piano, fatturazionePeriodicita: risolto.periodicita } : {}),
    },
  });
}

async function gestisciSubscriptionCancellata(subscription) {
  const tenant = await trovaTenantDaSubscription(subscription);
  if (!tenant) return;

  // NON cancella mai dati operativi: solo lo stato dell'abbonamento.
  // La retention dei dati dopo la cancellazione resta una decisione
  // esplicita e manuale (vedi punto 18/42 del prompt), non automatica.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { subscriptionStatus: "CANCELED", cancelAtPeriodEnd: false },
  });

  creaNotificaRuoli({
    tenantId: tenant.id, ruoli: ["ADMIN"], categoria: "PAGAMENTI",
    titolo: "Abbonamento cancellato", messaggio: "L'abbonamento è stato cancellato. I tuoi dati restano al sicuro.",
  }).catch((err) => console.error("[billing] Errore notifica cancellazione:", err.message));
}

async function gestisciPagamentoFallito(invoice) {
  const tenant = await prisma.tenant.findFirst({ where: { stripeCustomerId: String(invoice.customer) } });
  if (!tenant) return;

  await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionStatus: "PAST_DUE" } });

  creaNotificaRuoli({
    tenantId: tenant.id, ruoli: ["ADMIN"], categoria: "PAGAMENTI",
    titolo: "Pagamento non riuscito", messaggio: "Il pagamento dell'ultimo rinnovo non è andato a buon fine. Aggiorna il metodo di pagamento per evitare la sospensione.",
  }).catch((err) => console.error("[billing] Errore notifica pagamento fallito:", err.message));
}

async function gestisciPagamentoRiuscito(invoice) {
  const tenant = await prisma.tenant.findFirst({ where: { stripeCustomerId: String(invoice.customer) } });
  if (!tenant) return;
  if (tenant.subscriptionStatus === "PAST_DUE") {
    await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionStatus: "ACTIVE" } });
  }
}
