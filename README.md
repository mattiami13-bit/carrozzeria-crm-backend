# Rifless — backend

API REST multi-tenant per Rifless, il gestionale SaaS per carrozzerie
(clienti, veicoli, preventivi, workflow, magazzino, portale cliente,
fatturazione in abbonamento, moduli AI, e la piattaforma di vendita
pubblica attorno al prodotto). Node.js + Express + Prisma + PostgreSQL
(Supabase) + Stripe + Twilio + Resend + Anthropic.

Questo file è il punto di ingresso. Per il dettaglio di un'area
specifica, ogni sezione qui sotto rimanda al documento dedicato — questo
README non li duplica, per non disallinearsi nel tempo (vedi
[MIGRATIONS.md](MIGRATIONS.md) per un esempio reale di documentazione
che era andata fuori sincro col codice, e come è stato corretto).

## Installazione

```bash
git clone <url-del-repository>
cd backend
npm install
cp .env.example .env
```

Poi imposta almeno `DATABASE_URL`, `DIRECT_URL` (Postgres — vedi
"Database" sotto) e `JWT_SECRET` (minimo 32 caratteri: il server si
rifiuta di avviarsi senza, vedi `src/index.js`) in `.env`. Tutto il
resto è opzionale in locale: ogni integrazione esterna (Stripe, Resend,
Twilio, Anthropic, Supabase Storage) si comporta come "non configurata"
se manca la relativa variabile, senza far crashare il server.

## Sviluppo locale

```bash
npm run dev
```

Avvia con `--watch` su `http://localhost:4000` (porta configurabile via
`PORT`). Il gestionale vero e proprio è il file statico
`frontend/carrozzeria-crm-app.html` (mirror del sorgente canonico
tenuto fuori da questo repository — vedi `tests/check-frontend.cjs` per
come viene verificato): impostando `CRM_PREVIEW=1` viene servito anche
da questo backend su `/crm`, solo per anteprima interna.

Non esiste un ambiente "staging" separato: ogni punto del prodotto
viene verificato in locale con i test automatici, poi live in
produzione dopo ogni push — vedi [PRODUCTION.md](PRODUCTION.md) per il
dettaglio di come sono strutturati gli ambienti.

## Environment variables

`.env.example` è la fonte di verità, con un commento per ogni
variabile che spiega da dove viene e a cosa serve — non ripetuto qui.
In sintesi, per categoria:

- **Database**: `DATABASE_URL` (pooler, usata dall'app), `DIRECT_URL`
  (connessione diretta, usata solo dalle migrazioni).
- **Autenticazione**: `JWT_SECRET`, `JWT_EXPIRES_IN`.
- **Dominio e ambiente**: `CORS_ORIGINS`, `APP_HOSTNAME`,
  `PUBLIC_APP_URL`, `APP_ENV` — vedi [PRODUCTION.md](PRODUCTION.md).
- **Storage foto/documenti**: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Email**: `RESEND_API_KEY`, `CONTATTI_EMAIL_DESTINATARIO`.
- **WhatsApp**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_NUMBER`, `TWILIO_WHATSAPP_CONTENT_SID`,
  `TWILIO_WHATSAPP_STATUS_CALLBACK_URL`.
- **AI**: `ANTHROPIC_API_KEY`, `PHOTO_AI_MODEL`.
- **Fatturazione**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, tutti
  gli `STRIPE_PRICE_*` — vedi [BILLING.md](BILLING.md).
- **Worker in-process**: `DELAY_WORKER`, `BRIEFING_WORKER`,
  `PHOTO_BACKUP_WORKER`, `DATA_EXPORT_CLEANUP_WORKER` (`"0"` per
  disattivarli).
- **Altro**: `PORT`, `CRM_PREVIEW`, `MAINTENANCE_MODE`,
  `ACCOUNT_DELETION_GRACE_DAYS`.

## Database

PostgreSQL su Supabase, mai SQLite (nonostante quanto affermasse una
versione precedente di questo file): tutte e 37+ le migrazioni in
`prisma/migrations/` sono scritte per Postgres. Schema in
`prisma/schema.prisma`, client generato in `src/generated/prisma/`
(versionato: `npm run prisma:generate` dopo ogni pull che tocca lo
schema). Row Level Security abilitata su ogni tabella creata dal punto
19 in poi — vedi [SECURITY.md](SECURITY.md).

## Migration

```bash
# Sviluppo: crea e applica una nuova migrazione, interattivo
npx prisma migrate dev --name nome_della_modifica

# Produzione: applica le migrazioni non ancora applicate
npm run prisma:migrate-deploy-sicuro   # controlla prima pattern distruttivi
# oppure, equivalente al controllo già fatto a mano:
npx prisma migrate deploy
```

Mai una modifica allo schema fatta a mano contro il database (SQL
Editor di Supabase, `psql`, `prisma db push`) — sempre un file di
migrazione versionato. Dettaglio completo, incluso cosa fare prima di
una migrazione distruttiva, in [MIGRATIONS.md](MIGRATIONS.md).

## Seed

```bash
npm run seed:super-admin      # crea il primo (e unico) account super-admin — vedi SUPER-ADMIN.md
npm run seed:demo             # crea/aggiorna il tenant "Rifless Demo" isolato dai dati reali — vedi DEMO.md
npm run seed:demo:reset       # come sopra, ma azzera prima i dati demo esistenti
npm run seed:faq              # popola le FAQ pubbliche (solo se la tabella è vuota)
npm run seed:feature-flags    # crea i feature flag che il codice già referenzia, attivi di default
```

Ogni script è idempotente e pensato per essere rieseguito senza
duplicare dati — quello per il super-admin è l'unico deliberatamente
one-time (si rifiuta di girare una seconda volta).

## Test

```bash
npm run test:<area>           # vedi package.json per l'elenco completo (43 file)
node tests/check-frontend.cjs # verifica la sintassi JSX del gestionale e il mirror
```

Nessun mock: ogni test usa database e (dove pertinente) Supabase
Storage reali, crea dati propri con identificatori univoci, e li
ripulisce a fine esecuzione. Dettaglio completo in
[TESTING.md](TESTING.md).

## Stripe

Abbonamenti (piani STARTER/PRO/PREMIUM_AI, mensile/annuale), setup fee,
promo Early Adopter, pacchetto crediti AI aggiuntivi. Configurazione,
struttura dei piani, e cosa succede a ogni evento webhook in
[BILLING.md](BILLING.md).

## Webhook

- **Stripe**: `POST /api/billing/webhook` — firma verificata,
  idempotente per ID evento (`StripeWebhookEvent`). Vedi BILLING.md.
- **Twilio (stato messaggi WhatsApp)**: `POST /api/whatsapp/webhook/status`.
- **Twilio (risposte cliente in arrivo)**: `POST /api/whatsapp/webhook`.

Tutti e tre sono registrati in `src/index.js` PRIMA del parsing globale
del body JSON dove serve il body grezzo (Stripe firma il body grezzo,
non quello riparsato) — vedi i commenti nel file per l'ordine esatto di
montaggio delle route, che qui è significativo.

## Email

Resend, un solo mittente reale (`notifiche@rifless.it`,
`src/lib/email.js`) per tutte le email transazionali (benvenuto,
verifica, reset password, notifica ticket, notifica lead commerciale,
notifica export pronto) più le email al cliente finale sui cambi di
stato del veicolo (`src/lib/notifiche.js`). Ogni invio riuscito produce
un `UsageEvent` (punto 40) — vedi la dashboard usage del super-admin.

## Storage

Supabase Storage, tre bucket privati distinti, mai pubblici:

- `vehicle-photos` — foto veicolo, URL firmate a 1 ora, mai un link
  permanente (vedi SECURITY.md).
- `vehicle-photos-backup` — copia indipendente, sincronizzata ogni 6
  ore (vedi BACKUP-DISASTER-RECOVERY.md).
- `data-exports` — export dati asincroni (punto 43), URL firmate a 5
  minuti, file rimossi fisicamente 48h dopo la creazione.

## AI

Anthropic (Claude Sonnet 5), sei punti di integrazione distinti, ognuno
con la propria quota mensile per piano e il proprio log di costo
(`AiCostLog`, punto 41): assistente conversazionale, Copilot, AI Damage
Assistant, Insurance Gap Analysis, stima danni "legacy", e
classificazione automatica delle foto al caricamento. Dashboard costo
(oggi/mese/per tenant/per funzione/per piano) su
`GET /api/super-admin/ai-cost`.

## Deployment

Railway (auto-deploy da push su `main`), dietro il dominio
`www.rifless.it`. Nessun ambiente "staging": ogni modifica è verificata
in locale, poi live subito dopo il push. Dettaglio completo (HTTPS,
header di sicurezza, CORS, struttura dominio www/app, blocco Stripe
live-vs-test da risolvere se non ancora fatto) in
[PRODUCTION.md](PRODUCTION.md).

## Backup

Database: backup automatico giornaliero Supabase (retention 7gg, piano
Pro). Foto: sincronizzazione automatica su un secondo bucket ogni 6
ore. Dettaglio verificato punto per punto, incluso cosa NON è ancora
coperto, in [BACKUP-DISASTER-RECOVERY.md](BACKUP-DISASTER-RECOVERY.md).

## Super-admin

Account di livello piattaforma (mai un ruolo su `User`, un modello
Prisma separato — vedi SECURITY.md per il perché), per chi gestisce
Rifless stesso: visibilità su tutti i tenant, lead commerciali, ticket
di supporto, richieste GDPR, FAQ e changelog pubblici, feature flag,
usage e costo AI per tenant. Nessuna interfaccia grafica oggi, solo API
— dettaglio completo in [SUPER-ADMIN.md](SUPER-ADMIN.md).

## Isolamento multi-tenant

Ogni tabella con dati di un cliente ha `tenantId`. Il middleware
`requireAuth` legge il tenant **dal JWT firmato dal server**, mai da
input del client, ed ogni query Prisma nelle route lo include tramite
l'helper `tenantScope(req)`. Row Level Security a livello Postgres è
una seconda barriera indipendente. Dettaglio architetturale completo in
[TENANCY.md](TENANCY.md).

## Altra documentazione

[ARCHITECTURE.md](ARCHITECTURE.md) ·
[SECURITY.md](SECURITY.md) ·
[BILLING.md](BILLING.md) ·
[TENANCY.md](TENANCY.md) ·
[PRODUCTION.md](PRODUCTION.md) ·
[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) ·
[CHECKLIST_GO_LIVE.md](CHECKLIST_GO_LIVE.md) ·
[MIGRATIONS.md](MIGRATIONS.md) ·
[TESTING.md](TESTING.md) ·
[BACKUP-DISASTER-RECOVERY.md](BACKUP-DISASTER-RECOVERY.md) ·
[SUPER-ADMIN.md](SUPER-ADMIN.md) ·
[DEMO.md](DEMO.md) ·
[MONITORING.md](MONITORING.md) ·
[PERFORMANCE.md](PERFORMANCE.md) ·
[RESPONSIVE.md](RESPONSIVE.md) ·
[ACCESSIBILITY.md](ACCESSIBILITY.md)
