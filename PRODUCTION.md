# Produzione (punto 32)

## Ambienti

Un solo ambiente di produzione reale oggi:

- **Produzione**: Railway, progetto `intelligent-light` → servizio
  `carrozzeria-crm-backend`, dietro il dominio `www.rifless.it`.
  Database Supabase progetto `carrozzeria-crm` (dati reali).
- **Sviluppo/locale**: `node src/index.js` (o `npm run dev`) su questa
  macchina, stesso codice, variabili d'ambiente diverse (vedi `.env`,
  mai versionato — solo `.env.example` come riferimento).
- **Test**: la suite (`node --test tests/*.test.js`) gira contro lo
  stesso database di sviluppo/produzione configurato in `DATABASE_URL`
  al momento dell'esecuzione, creando ed eliminando righe proprie
  (tenant/utenti con email uniche per test, puliti in blocchi
  `finally`) — non esiste un database "test" separato oggi.

Non esiste un ambiente "staging" separato: non è mai stato necessario
finora, dato che ogni punto del prompt viene verificato prima in
locale/con test automatici e poi live in produzione dopo ogni push.

`APP_ENV` (punto 39, feature flag) identifica l'ambiente corrente solo
per la restrizione opzionale "ambienti" di un flag — non imposta nessun
comportamento diverso nel resto del codice. Non impostata in produzione
oggi: usa il default `"production"`.

Il codice non contiene mai URL, domini o segreti hardcoded: tutto
arriva da variabili d'ambiente lette a runtime (vedi `.env.example`).
Non c'è un branch `if (NODE_ENV === "production")` da nessuna parte nel
codice — non è mai servito perché il comportamento (log, errori,
sicurezza) è già lo stesso e corretto in entrambi i casi; l'unica cosa
che cambia davvero tra ambienti sono le variabili d'ambiente stesse.

## Checklist di verifica (stato reale, verificato oggi)

- **HTTPS**: ✅ Railway forza il redirect (verificato:
  `http://www.rifless.it` → 301 → `https://...`). Aggiunto oggi
  `helmet` per l'header `Strict-Transport-Security` (HSTS) e gli altri
  header di sicurezza di base (`X-Content-Type-Options`,
  `X-Frame-Options`, niente più `X-Powered-By`) — mancavano del tutto
  prima. CSP disattivata deliberatamente: le pagine statiche (portale,
  verifica email, reset password) usano script inline e una CSP di
  default le avrebbe rotte — intervento a sé, non di questo punto.
- **Cookie sicuri**: ✅ non applicabile — l'app non usa MAI cookie,
  l'autenticazione è sempre Bearer JWT (verificato: nessun `res.cookie`
  o libreria di sessione in tutto `src/`). La rotta statica `/cookie`
  è solo la pagina di informativa, non imposta cookie.
- **Database di produzione**: ✅ Supabase progetto `carrozzeria-crm`,
  dati reali, RLS verificata (punti 19 e l'incidente di sicurezza
  Supabase già risolti).
- **Storage di produzione**: ✅ bucket Supabase Storage privato con URL
  firmati (punto 19), più il worker di backup foto (punto 22).
- **Email di produzione**: ⚠️ trovato e corretto oggi — la mail con il
  link del portale cliente (`inviaLinkPortale` in
  `src/lib/notifiche.js`) partiva ancora dal dominio sandbox di Resend
  (`onboarding@resend.dev`) con il vecchio nome "Ombra CRM", invece del
  mittente reale `notifiche@rifless.it` usato correttamente da tutte le
  altre email transazionali. Un dominio sandbox recapita in modo
  inaffidabile (spesso solo alla propria casella di test) — un cliente
  reale della carrozzeria rischiava di non ricevere mai il link. Ora
  usa lo stesso mittente delle altre.
- **CORS / allowed origins**: ✅ whitelist da `CORS_ORIGINS`, verificata
  in produzione: un'origine non in whitelist viene rifiutata, una in
  whitelist passa. Corretto oggi un difetto minore: un'origine
  rifiutata rispondeva 500 "errore interno del server" ed era loggata
  come un crash — ora risponde correttamente 403 e non inquina i log
  di errore/monitoraggio del punto 24 con falsi positivi (bot, scanner,
  richieste da siti di terzi).
- **Logging**: ✅ log strutturati (JSON) su stdout per ogni richiesta
  (punto 24) ed errore (qui sopra), catturati da Railway.
- **Monitoring**: ✅ `/health` verifica davvero il database, non
  risponde sempre ok (punto 24); dashboard Railway per CPU/memoria/
  riavvii.
- **Webhook di produzione**: ✅ endpoint `/api/billing/webhook`
  raggiungibile e configurato lato Stripe (idempotente per ID evento,
  punto 30), ma vedi il blocco critico sotto: oggi verifica firme di
  un webhook configurato in modalità TEST.

## 🔴 BLOCCANTE: Stripe è in modalità TEST in produzione

Verificato oggi creando una vera sessione di checkout contro
`https://www.rifless.it` (nessun addebito, solo generazione URL): la
sessione restituita è `cs_test_...`, non `cs_live_...`. Significa che
`STRIPE_SECRET_KEY` impostata su Railway è una chiave **test**
(`sk_test_...`), non live.

Conseguenza pratica: **nessun pagamento reale può avvenire oggi**, nemmeno
se un cliente vero prova a sottoscrivere un abbonamento con una carta
vera — Stripe in modalità test la rifiuta o simula, non addebita mai
nulla. Il prodotto non è ancora vendibile finché questo non viene
sistemato.

Non posso risolverlo io: richiede scelte e credenziali che sono solo
tue (il tuo account Stripe, le variabili d'ambiente su Railway). Prima
di annunciare/vendere il prodotto va fatto così:

1. **Nel Dashboard Stripe**, passa dalla modalità Test alla modalità
   Live (interruttore in alto), poi ricrea lì i Product/Price per ogni
   piano (STARTER, PRO, PREMIUM_AI, mensile e annuale), il prezzo setup
   fee, il prezzo Early Adopter, il pacchetto crediti AI — gli ID
   `price_...` in modalità live sono DIVERSI da quelli test già in uso.
2. Crea un webhook endpoint live (Dashboard → Sviluppatori → Webhook)
   puntato su `https://www.rifless.it/api/billing/webhook`, e prendi il
   nuovo signing secret live (`whsec_...`).
3. Prendi la Secret Key live (`sk_live_...`).
4. Su Railway (progetto `intelligent-light` → servizio
   `carrozzeria-crm-backend` → Variables), sostituisci: `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, e tutti gli `STRIPE_PRICE_*` con i valori
   live del punto 1-3.
5. Fammi sapere quando è fatto: verifico subito con lo stesso test
   (sessione di checkout reale) che la risposta sia `cs_live_...`.

Fino ad allora il sito è pubblico e funzionante, ma qualsiasi checkout
resta in modalità test — va bene per continuare a testare, non per
vendere davvero.

## Punto 33: dominio e URL

Struttura prevista: `www.rifless.it` = sito commerciale,
`app.rifless.it` = gestionale, eventualmente `status.rifless.it` in
futuro. Nessun dominio è mai scritto a mano nel codice — sempre da
variabili d'ambiente (`CORS_ORIGINS`, `APP_HOSTNAME`) o derivato a
runtime da `req`/`window.location`.

**Trovato e corretto oggi**: il gestionale (`carrozzeria-crm-app.html`)
aveva l'URL dell'API scritto a mano
(`https://carrozzeria-crm-backend-production.up.railway.app`, il
vecchio dominio Railway) invece di usare il dominio corrente — esatto
contrario di quanto richiede questo punto. Ora l'API usa sempre la
stessa origine da cui il gestionale viene servito (funziona
automaticamente su qualsiasi host, presente o futuro), con un unico
fallback assoluto (`https://www.rifless.it`) per l'unico caso senza
un'origine di rete: il file aperto localmente (`file://`).

**Predisposto lato codice**: lo stesso servizio Express ora risponde
con il gestionale (non più solo con il sito commerciale) quando la
richiesta arriva con host `app.rifless.it` (configurabile con
`APP_HOSTNAME`) — verificato in locale con una richiesta `Host:
app.rifless.it` che restituisce correttamente il gestionale invece del
sito. **Manca solo il collegamento del dominio stesso**, che richiede
due azioni nei tuoi account (non posso farle: la prima richiede login,
la seconda l'accesso al pannello del tuo registrar):

1. **Railway** → progetto `intelligent-light` → servizio
   `carrozzeria-crm-backend` → tab Settings → Networking → "Custom
   Domain" → aggiungi `app.rifless.it`. Railway mostrerà un valore CNAME
   specifico per questo dominio (diverso da quello già usato per
   `www.rifless.it`).
2. **Dal pannello DNS del tuo registrar** (dove hai già configurato
   `www.rifless.it`): aggiungi un record CNAME con host `app` che punta
   al valore mostrato da Railway al passo 1.

Fatto questo (la propagazione DNS può richiedere qualche minuto),
`https://app.rifless.it` servirà il gestionale — fammelo sapere e
verifico.

`status.rifless.it` non è stato predisposto: nessuna pagina di stato
esiste ancora oggi (il prompt lo definisce "eventuale") — intervento a
sé se in futuro vorrai una status page pubblica.
