# Sicurezza

Stato verificato il 17/09/2026 (punto 45). Ogni voce qui sotto è stata
controllata nel codice reale mentre veniva scritta questa pagina, non
copiata da una checklist generica.

## Autenticazione

- **Password**: bcrypt, 12 round (`src/routes/auth.js`), mai in chiaro
  in nessuna tabella, mai loggate (vedi "Audit log" sotto).
- **Token**: JWT firmato dal server, `JWT_EXPIRES_IN` (default 8h). Il
  server **si rifiuta di avviarsi** se `JWT_SECRET` manca o è più corto
  di 32 caratteri (`src/index.js`) — senza quel controllo, `jsonwebtoken`
  firmerebbe comunque con un valore debole/`undefined`, un rischio di
  forgery scoperto solo in produzione.
- **Rate limiting**: `loginLimiter` (10/15min), `registerLimiter`
  (10/ora), `emailActionLimiter` (5/15min — reset password, reinvio
  verifica), `leadFormLimiter` (8/ora — contatti/demo pubblici). Tutti
  keyed per IP, `src/middleware/rateLimit.js`.

## Multi-tenancy

Vedi [TENANCY.md](TENANCY.md) per il dettaglio completo. In sintesi: il
`tenantId` viene **sempre** dal JWT firmato dal server, mai da input
del client; `requireAuth` rifiuta esplicitamente un token senza
`tenantId` (necessario da quando esiste un secondo tipo di token, quello
super-admin — vedi sotto) invece di lasciare che Prisma tratti un
`tenantId: undefined` come "nessun filtro" e restituisca dati di tutti
i tenant.

## Super-admin: modello separato, non un ruolo

Un account super-admin non è uno `User` con un ruolo speciale: è un
modello Prisma (`SuperAdmin`) e un middleware (`requireSuperAdmin`) del
tutto separati. Motivo concreto, non teorico: se fosse solo un ruolo su
`User`, un token super-admin senza `tenantId` che finisse per errore su
una rotta tenant-scoped darebbe accesso a tutti i tenant invece di un
401 — vedi il commento in `src/middleware/auth.js` e i test di
confine in `tests/super-admin.test.js`. Dettaglio in
[SUPER-ADMIN.md](SUPER-ADMIN.md).

## Row Level Security (RLS)

Ogni tabella creata dal punto 19 in poi ha `ENABLE ROW LEVEL SECURITY`
nella STESSA migrazione che la crea (regola nata da un incidente reale:
un'allerta Supabase Security Advisor ha trovato `stripe_webhook_events`
senza RLS, creata prima che questa fosse la convenzione). Due
sfumature verificate empiricamente, non assunte:

- La connessione dell'app stessa (Prisma, ruolo owner) **bypassa** RLS
  per definizione in Postgres a meno di `FORCE ROW LEVEL SECURITY`
  (non impostato) — quindi RLS oggi non protegge dall'applicazione
  stessa, protegge da un secondo canale di accesso.
- L'API REST pubblica auto-generata da Supabase (PostgREST, ruoli
  `anon`/`authenticated`) **è** soggetta a RLS anche senza FORCE —
  verificato con richieste dirette contro quell'API con la chiave
  pubblica reale: i dati di un tenant non sono raggiungibili da lì.

## Storage: bucket privati, URL firmate

Nessun bucket Supabase Storage è pubblico. Foto veicolo, backup foto, e
export dati sono serviti solo tramite URL firmate generate al momento
della richiesta (mai salvate), con scadenza breve — 1 ora per le foto,
5 minuti per gli export. Il path di storage stesso incorpora sempre il
`tenantId` e viene validato lato server prima di firmare qualunque URL
(`photoStoragePath` in `src/lib/photo-timeline.js`): non basta
conoscere/indovinare un path per ottenere una firma.

## Header di sicurezza e rete

`helmet` (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, niente
`X-Powered-By`) — aggiunto al punto 32, mancava del tutto prima. CSP
deliberatamente disattivata: alcune pagine statiche usano script
inline e una CSP di default le avrebbe rotte, intervento a sé. CORS a
whitelist esplicita (`CORS_ORIGINS`), verificato che un'origine non
in whitelist riceva 403 (non un 500 travestito da errore server — bug
trovato e corretto al punto 32) e nessun header CORS.

## Audit log

Middleware globale (`src/middleware/audit.js`) su ogni scrittura
(POST/PATCH/PUT/DELETE) e ogni tentativo respinto (401/403), più poche
GET semanticamente rilevanti (export dati, verifica email). L'elenco
`AZIONI` estrae SOLO campi espliciti e sicuri dal body per ogni singola
rotta — mai un dump di `req.body` intero — per costruzione, così una
rotta che in futuro aggiunge un campo sensibile non finisce mai
nell'audit log per errore.

## Eliminazione account: mai immediata

Riautenticazione (password) + conferma testuale (ragione sociale
esatta) prima di avviare la cancellazione di un'intera organizzazione,
poi un periodo di grazia annullabile (`ACCOUNT_DELETION_GRACE_DAYS`,
default 30gg) prima che diventi eseguibile — mai in automatico, sempre
un intervento manuale deliberato del super-admin. Stesso principio per
le richieste GDPR in generale: nessuna cancellazione distruttiva parte
mai da sola. Dettaglio nel commento su
`Tenant.eliminazioneRichiestaAt` in `schema.prisma`.

## Cosa NON è ancora coperto (onestamente)

- **Stripe in produzione usa ancora chiavi test**, non live — bloccante
  per vendere davvero, non per la sicurezza in sé. Vedi
  [PRODUCTION.md](PRODUCTION.md).
- **Nessun secondo provider di storage indipendente** per il backup
  foto (stesso progetto Supabase per origine e backup): protegge da
  cancellazione/corruzione applicativa, non da un incidente esteso
  all'intero progetto Supabase. Vedi
  [BACKUP-DISASTER-RECOVERY.md](BACKUP-DISASTER-RECOVERY.md).
- **Nessun 2FA** per utenti o super-admin: solo password.
