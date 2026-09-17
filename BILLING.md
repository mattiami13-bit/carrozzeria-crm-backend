# Fatturazione (Stripe)

Stato verificato il 17/09/2026 (punto 45). Fonte unica dei numeri:
`src/lib/billing/piani.js` — questo file riassume, non duplica: se un
prezzo cambia lì, va aggiornato qui a mano (nessun collegamento
automatico tra questa pagina e il codice).

## Piani

| Piano | Prezzo mensile | Prezzo annuale | Utenti inclusi | Crediti AI/mese |
|---|---|---|---|---|
| Starter | 79€ | 790€ | 3 | 0 |
| Pro | 149€ | 1.490€ | 10 | 0 |
| Premium AI | 249€ | 2.490€ | 20 | 1.000 |

Prezzi IVA esclusa. Ogni feature del prodotto è un booleano nella
matrice `PIANI[piano].features` — è l'unica fonte usata sia dal
middleware `requireFeature` (punto 29, "il tuo piano include questa
funzione?") sia dalla pagina piani pubblica.

- **Trial**: 30 giorni, entitlement del piano Pro, nessuna carta
  richiesta alla registrazione (`TRIAL_GIORNI`/`TRIAL_PIANO` in
  `piani.js` — occhio: la durata reale è calcolata a parte in
  `routes/auth.js`, la costante qui è tenuta allineata a mano, trovata
  disallineata una volta, punto 36).
- **Setup fee**: 199€, solo al primo checkout di un tenant (mai
  ripetuta), gratuita per la promo Early Adopter.
- **Early Adopter**: piano Pro mensile a 99€/mese per 12 mesi, primi 30
  iscritti (`EARLY_ADOPTER` in `piani.js`) — **la reversione automatica
  al prezzo normale dopo i 12 mesi non è implementata** (richiederebbe
  un job schedulato o una subscription schedule Stripe), gap onesto.
- **Crediti AI extra**: pacchetto una tantum da 500 crediti a 29€,
  cumulabile (non sostituisce, si somma a quelli già disponibili).
- **Utente extra**: 15€/mese per utente oltre gli inclusi nel piano —
  **il meccanismo di acquisto non è implementato** (nessun prezzo
  Stripe configurato), gap onesto documentato anche in TESTING.md.

## Checkout e cambio piano

`POST /api/billing/checkout` (solo ADMIN) — stesso endpoint per primo
acquisto, upgrade e downgrade. Il downgrade è bloccato (409) se gli
utenti attivi del tenant superano quelli inclusi nel piano di
destinazione: va prima ridotto il numero di utenti, nessuna
disattivazione automatica. `POST /api/billing/crediti-ai` — acquisto
one-time dei crediti extra, richiede un customer Stripe già esistente
(cioè un piano già attivo). `POST /api/billing/portal` — Stripe
Customer Portal per gestione autonoma di metodo di pagamento, fatture,
cancellazione.

## Webhook

`POST /api/billing/webhook` — firma verificata (`STRIPE_WEBHOOK_SECRET`),
**idempotente per ID evento** (tabella `StripeWebhookEvent`, un evento
duplicato viene scartato prima di qualunque logica di business). Eventi
gestiti:

- `checkout.session.completed` — attiva il piano/i crediti acquistati.
- `customer.subscription.updated` — sincronizza piano e stato
  (`Tenant.subscriptionStatus`) a ogni cambiamento lato Stripe,
  incluso un upgrade/downgrade fatto direttamente nel Customer Portal.
- `customer.subscription.deleted` — marca l'abbonamento cancellato.
- `invoice.payment_failed` — marca `PAST_DUE` (grace period: NON blocca
  subito l'accesso, vedi `middleware/subscription.js`).
- `invoice.paid` — riporta `ACTIVE` un abbonamento rientrato da
  `PAST_DUE`.

## Stato bloccante: chiavi test in produzione

**Verificato il 16/09/2026 creando una vera sessione di checkout contro
`www.rifless.it`: risposta `cs_test_...`, non `cs_live_...`.** Nessun
pagamento reale può avvenire oggi. Procedura per passare a chiavi live
in [PRODUCTION.md](PRODUCTION.md) — verificare che sia stato risolto
prima di considerare il prodotto vendibile.

## Documenti correlati

[TENANCY.md](TENANCY.md) (come lo stato abbonamento blocca/non blocca
l'accesso) · [PRODUCTION.md](PRODUCTION.md)
