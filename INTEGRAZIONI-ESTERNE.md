# Integrazioni esterne (punto 50)

Nessuna chiave, ID o segreto in questo progetto è mai stato inventato:
dove serve una credenziale esterna, il codice legge sempre una variabile
d'ambiente (mai un valore scritto a mano — verificato di nuovo oggi con
una ricerca nel codice di pattern tipo chiavi Stripe/Twilio hardcoded:
nessuna trovata). Se una variabile manca, la funzione che ne ha bisogno
fallisce onestamente (es. `501 Not Implemented` o un messaggio "non
disponibile"), non finge di funzionare.

Questo documento elenca, per ciascuna integrazione: **cosa serve**,
**perché serve**, **dove recuperarla**, **quale variabile usare**. È il
riferimento a cui guardare ogni volta che manca una credenziale — le
stesse informazioni sono anche, più sinteticamente, nei commenti di
[.env.example](.env.example).

Stato reale in produzione oggi (verificato via `/health`): database,
storage foto, email e WhatsApp sono configurati e funzionanti; i
pagamenti Stripe sono configurati ma **in modalità test** (vedi
[PRODUCTION.md](PRODUCTION.md) — bloccante per la vendita reale); l'AI
(Anthropic) è configurata.

---

## 1. Stripe (pagamenti e abbonamenti)

**Cosa serve:**
- `STRIPE_SECRET_KEY` — chiave segreta dell'account Stripe.
- `STRIPE_WEBHOOK_SECRET` — firma per verificare che gli eventi webhook
  arrivino davvero da Stripe (non da un chiamante qualsiasi).
- Un Price ID Stripe per ciascuna combinazione piano/periodicità:
  `STRIPE_PRICE_STARTER_MENSILE`, `STRIPE_PRICE_STARTER_ANNUALE`,
  `STRIPE_PRICE_PRO_MENSILE`, `STRIPE_PRICE_PRO_ANNUALE`,
  `STRIPE_PRICE_PREMIUM_AI_MENSILE`, `STRIPE_PRICE_PREMIUM_AI_ANNUALE`.
- `STRIPE_PRICE_SETUP_FEE` — costo di attivazione una tantum (199€+IVA).
- `STRIPE_PRICE_EARLY_ADOPTER_PRO` — prezzo scontato promo Early Adopter
  (99€/mese, primi 30 clienti).
- `STRIPE_PRICE_AI_CREDITI_PACK` — pacchetto crediti AI aggiuntivi (500
  crediti, 29€+IVA).

**Perché serve:** è l'unico modo in cui un cliente reale può pagare un
abbonamento. Senza queste variabili, `POST /api/billing/checkout` e
`POST /api/billing/crediti-ai` rispondono `501 Not Implemented` invece di
fingere un pagamento — nessun incasso può avvenire, ma nemmeno nessun
falso "pagamento riuscito".

**Dove recuperarla:**
- Chiave segreta e webhook secret: Dashboard Stripe → **Sviluppatori →
  Chiavi API** (chiave) e **Sviluppatori → Webhook** → crea un endpoint
  puntato su `https://www.rifless.it/api/billing/webhook` → **Signing
  secret**.
- Price ID: Dashboard Stripe → **Catalogo prodotti** → crea un Product
  per ciascun piano, con due Price collegati (mensile e annuale) →
  copia l'ID che inizia con `price_...`.
- **Importante**: le chiavi/ID test (`sk_test_...`, prezzi creati in
  modalità test) e quelle live (`sk_live_...`) sono account/cataloghi
  separati in Stripe — vanno create due volte, e il webhook va
  registrato separatamente per ciascuna modalità (un webhook creato in
  test non riceve eventi live). Oggi in produzione sono impostate le
  chiavi **test** — è il blocco #1 per la vendita reale, vedi la sezione
  "BLOCCANTE: Stripe è in modalità TEST in produzione" in
  [PRODUCTION.md](PRODUCTION.md).

**Quale variabile usare:** tutte quelle elencate sopra, su Railway →
servizio → **Variables**.

---

## 2. WhatsApp (Twilio)

**Cosa serve:**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — credenziali dell'account
  Twilio.
- `TWILIO_WHATSAPP_NUMBER` — il numero WhatsApp Business mittente
  (formato `whatsapp:+1415...`).
- `TWILIO_WHATSAPP_CONTENT_SID` — template di messaggio approvato da
  Meta, richiesto per iniziare una conversazione WhatsApp fuori dalla
  finestra di 24 ore di risposta libera.
- `TWILIO_WHATSAPP_STATUS_CALLBACK_URL` — endpoint a cui Twilio notifica
  lo stato di consegna di ogni messaggio (consegnato/letto/fallito).

**Perché serve:** l'invio automatico di messaggi WhatsApp al cliente a
ogni cambio di stato della pratica (punto 17-ish, comunicazioni
automatiche) passa da Twilio, unico modo reale di mandare WhatsApp da
codice — non esiste un invio "diretto" senza un provider autorizzato da
Meta.

**Dove recuperarla:** [Twilio Console](https://console.twilio.com) →
Account SID/Auth Token nella dashboard principale; il numero e il
template richiedono l'attivazione di **Twilio WhatsApp Business API**
(serve approvazione Meta per il numero mittente e per ogni template di
messaggio).

**Quale variabile usare:** le cinque sopra, su Railway → Variables.
Nota già registrata in memoria di progetto: resta da collegare il
webhook Twilio Console → Status Callback URL puntato sull'URL reale di
produzione (passaggio manuale lato Twilio, non automatizzabile da qui).

---

## 3. Email transazionali (Resend)

**Cosa serve:** `RESEND_API_KEY`.

**Perché serve:** invio di email reali (benvenuto, verifica indirizzo,
reset password, notifiche export dati pronto, notifiche commerciali).
Senza questa variabile le email non partono — verificato che il codice
lo segnali in log (`RESEND_API_KEY assente, email non inviata a ...`),
mai un finto "inviata".

**Dove recuperarla:** [Resend](https://resend.com) → **API Keys** →
crea una chiave. Il dominio mittente (`rifless.it`) deve anche essere
verificato in Resend → **Domains** (record DNS SPF/DKIM) perché le email
non finiscano in spam.

**Quale variabile usare:** `RESEND_API_KEY`, su Railway → Variables.
Già configurata e funzionante in produzione.

---

## 4. Storage (Supabase)

**Cosa serve:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, più i tre
bucket privati: `vehicle-photos` (foto pratiche), `vehicle-photos-backup`
(copia di sicurezza ogni 6 ore), `data-exports` (export dati GDPR,
punto 43).

**Perché serve:** upload/lettura delle foto veicolo (con URL firmati a
tempo, mai pubblici) e la generazione dei file di export dati richiesti
da un cliente. `SUPABASE_SERVICE_ROLE_KEY` bypassa ogni policy di
sicurezza — per questo resta **solo** lato server, mai esposta al
frontend.

**Dove recuperarla:** Dashboard Supabase → progetto `carrozzeria-crm` →
**Impostazioni progetto → API** (URL e service role key); i bucket si
creano da **Storage** (o via lo script incluso
`scripts/setup-data-exports-bucket.mjs` per quello degli export).

**Quale variabile usare:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
su Railway → Variables. Già configurate e funzionanti in produzione.

*(Stesso progetto Supabase fornisce anche il database Postgres —
`DATABASE_URL`/`DIRECT_URL` — non elencato tra le "integrazioni esterne"
del punto 50 perché è l'infrastruttura dati di base del prodotto, non un
servizio opzionale, ma la credenziale segue lo stesso principio: mai
inventata, sempre da variabile d'ambiente.)*

---

## 5. Dominio

**Cosa serve:** DNS del dominio `rifless.it` puntato su Railway, per due
host: `www.rifless.it` (sito pubblico, già attivo) e `app.rifless.it`
(gestionale, predisposto lato codice ma **DNS non ancora collegato** —
vedi [PRODUCTION.md](PRODUCTION.md#punto-33-dominio-e-url)).

**Perché serve:** senza il secondo host collegato, il gestionale vero e
proprio non è raggiungibile da un dominio pubblico reale (oggi
verificabile solo internamente, vedi punto 48/49 di questa sessione).

**Dove recuperarla:** non è una "chiave" ma una configurazione: Railway
→ servizio → **Settings → Domains → Custom Domain** → aggiungi
`app.rifless.it` → Railway fornisce un record CNAME da creare presso il
registrar del dominio (dove `rifless.it` è stato acquistato).

**Quale variabile usare:** nessuna variabile segreta — solo
`APP_HOSTNAME` (già impostata a `app.rifless.it`) che dice al codice
quale host servire come gestionale, una volta che il DNS punta lì.

---

## 6. AI provider (Anthropic)

**Cosa serve:** `ANTHROPIC_API_KEY`; opzionalmente `PHOTO_AI_MODEL` per
scegliere il modello usato nell'analisi foto (se non impostata, il
codice usa un default esplicito, mai un modello indovinato).

**Perché serve:** alimenta AI Copilot, AI Damage Assistant, Insurance
Gap, Predictive Delay AI, Morning Briefing — tutte le funzioni del piano
Premium AI. Senza questa chiave, ognuna di queste funzioni risponde con
un errore chiaro ("Funzione AI non disponibile al momento...", corretto
al punto 49 di questa sessione) invece di un finto risultato AI.

**Dove recuperarla:** [console.anthropic.com](https://console.anthropic.com)
→ **API Keys** → crea una chiave. Richiede un metodo di pagamento
collegato sull'account Anthropic (costo a consumo, vedi
[BILLING.md](BILLING.md) per come viene tracciato e riaddebitato ai
piani).

**Quale variabile usare:** `ANTHROPIC_API_KEY`, su Railway → Variables.
Già configurata e funzionante in produzione.

---

## Altri segreti (non "esterni" ma comunque mai inventati)

- `JWT_SECRET` — firma i token di sessione. Non proviene da nessun
  servizio esterno: va generato una volta (es. `openssl rand -hex 32`) e
  impostato su Railway, minimo 32 caratteri (controllato all'avvio del
  server, che si rifiuta di partire altrimenti — vedi `src/index.js`).
- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` — non variabili
  d'ambiente permanenti: si passano solo al momento di eseguire
  `scripts/seed-super-admin.mjs` (`SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... node scripts/seed-super-admin.mjs`),
  scelta deliberata per non lasciare la password dell'account con
  accesso a tutti i tenant scritta in una variabile permanente.

## Riepilogo: cosa manca ancora per vendere davvero

Le uniche credenziali/configurazioni ancora mancanti o incomplete oggi
(stato verificato al punto 46/48/49 di questa sessione):

1. **Stripe in modalità live** (`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/Price ID live) — bloccante, nessun pagamento reale può avvenire finché resta in test.
2. **DNS di `app.rifless.it`** — il gestionale non è raggiungibile da un dominio pubblico reale finché non è collegato.
3. **Webhook Twilio Console → Status Callback URL** verso l'URL reale di produzione.

Nessun'altra integrazione manca; tutte le altre variabili elencate sopra
sono già impostate e verificate funzionanti in produzione.
