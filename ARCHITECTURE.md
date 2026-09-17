# Architettura

Stato verificato il 17/09/2026 (punto 45).

## Stack

- **Backend**: Node.js (ESM), Express 4, Prisma 7 (adapter `pg`,
  connessione diretta via `@prisma/adapter-pg`, non il client Prisma
  "tradizionale").
- **Database**: PostgreSQL su Supabase.
- **Storage file**: Supabase Storage (tre bucket privati — vedi
  [README.md](README.md#storage)).
- **Frontend gestionale**: un singolo file HTML (React 18 UMD + Babel
  standalone via CDN, nessuna build step), `frontend/carrozzeria-crm-app.html`.
- **Sito pubblico**: pagine HTML statiche indipendenti in `public/`
  (home, contatti, demo, FAQ, novità, privacy, termini, portale
  cliente, verifica email, reset password, ecc.), ciascuna un file
  autosufficiente senza framework.
- **Integrazioni esterne**: Stripe (fatturazione), Twilio (WhatsApp),
  Resend (email), Anthropic (AI).

## Struttura del codice

```
src/
  index.js           # entrypoint: middleware globali, montaggio di tutte le route, avvio worker
  routes/            # 38 file — un router Express per area funzionale
  lib/                # 31 file — logica riusabile (billing, email, AI, storage, usage...)
  middleware/         # auth, feature/flag gating, rate limit, audit, subscription, maintenance
  generated/prisma/   # client Prisma generato, versionato (non in .gitignore)
prisma/
  schema.prisma        # unico schema, tutti i modelli
  migrations/           # una cartella per migrazione, versionate (vedi MIGRATIONS.md)
public/                # sito pubblico e pagine statiche (una cartella per pagina)
frontend/               # mirror del gestionale (HTML singolo)
scripts/                 # seed, setup, controlli one-off (mai eseguiti da un utente finale)
tests/                    # 43 file, uno per area — vedi TESTING.md
```

## Come una richiesta attraversa l'app (`src/index.js`)

L'ordine di montaggio in `index.js` è significativo, non incidentale:

1. `helmet` (header di sicurezza), CORS a whitelist.
2. Parsing del body: **JSON per quasi tutto, ma `express.raw` per il
   webhook Stripe** (deve verificare la firma sul body grezzo, prima di
   qualunque riparsing) e `express.urlencoded` per il webhook Twilio.
3. `auditLogger`, `latencyLogger` — middleware globali "ad ascolto",
   non bloccanti.
4. `GET /health` — prima di `maintenanceMode`, deve rispondere anche
   quando il sito è in manutenzione.
5. `maintenanceMode`.
6. Pagine statiche pubbliche (home, contatti, demo, FAQ, ecc.) e — solo
   se l'host della richiesta è `APP_HOSTNAME` — il gestionale stesso
   (punto 33: `www.` serve il sito, `app.` serve il gestionale, stesso
   processo Express per entrambi).
7. Route pubbliche o che devono restare raggiungibili anche a un
   tenant bloccato: auth, super-admin, billing (checkout/webhook/portal),
   GDPR, supporto, WhatsApp webhook, portale cliente. **Devono** essere
   montate PRIMA del gate abbonamento al passo successivo, altrimenti
   un tenant con l'abbonamento scaduto non potrebbe né pagare per
   riattivarsi né esportare/cancellare i propri dati né chiedere aiuto.
8. `requireAbbonamentoAttivo` — da qui in giù, un tenant con abbonamento
   scaduto/cancellato riceve 402 sulle rotte operative.
9. Route operative (clienti, veicoli, preventivi, ecc.), alcune con
   `requireFeature(...)` (il piano include questa funzione?) e/o
   `requireFlag(...)` (è accesa in questo momento? — punto 39,
   indipendente dal piano) prima del router vero e proprio.
10. Error handler centralizzato — log strutturato lato server, mai
    dettagli interni (stack, SQL) nella risposta al client.

Dentro ogni router, il pattern quasi universale è: `requireAuth` →
(se serve) `requireRole(...)` → handler che scope-a ogni query Prisma
con `tenantScope(req)`.

## Worker in-process

Non un job queue esterno: `setInterval` con `.unref()` avviati da
`index.js` all'avvio del server, ciascuno disattivabile con una
variabile d'ambiente (`_WORKER=0`):

- `startDelayWorker` — ricalcola le previsioni di ritardo.
- `startBriefingWorker` — genera il Morning Briefing.
- `startPhotoBackupWorker` — sincronizza il bucket di backup foto ogni
  6 ore.
- `startDataExportCleanupWorker` — rimuove gli export dati scaduti
  ogni 6 ore.

## Perché un solo file HTML per il gestionale

Nessuna build step, nessun bundler: il file si apre direttamente nel
browser (anche come `file://` — uso reale documentato, vedi il
commento CORS in `index.js`) o viene servito da questo stesso backend.
Il compromesso esplicito: velocità di iterazione e zero configurazione
contro l'assenza di code-splitting/tree-shaking — accettabile alla
scala attuale del prodotto, da rivalutare se il file dovesse crescere
in modo da rendere il caricamento iniziale un problema reale (non
successo ad oggi).

## Documenti correlati

[TENANCY.md](TENANCY.md) (isolamento dati) ·
[SECURITY.md](SECURITY.md) ·
[BILLING.md](BILLING.md) ·
[PRODUCTION.md](PRODUCTION.md)
