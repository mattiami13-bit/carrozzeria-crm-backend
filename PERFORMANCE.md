# Performance

Audit e interventi del 15/09/2026 (punto 25 del prompt SaaS). Scala di
riferimento oggi: poche decine/centinaia di veicoli e clienti per
tenant (una singola carrozzeria) — molte delle osservazioni qui sotto
diventano rilevanti man mano che i tenant accumulano storico o se il
numero di tenant cresce, non necessariamente un problema oggi.

## Corretto in questa sessione

- **Query N+1 nel Copilot AI** (`src/routes/copilot.js`): tre strumenti
  (`margine_veicolo`, `preventivi_marginalita_bassa`,
  `disponibilita_tecnici_oggi`) facevano una query per ogni veicolo o
  tecnico dentro un ciclo, invece di una query unica con `in:[...]` e
  raggruppamento in memoria — stesso schema già usato altrove nel
  codice (es. `src/routes/profit.js`). Verificato con un test dedicato
  che il risultato resti identico, non solo che non lanci errori.
- **Payload eccessivo sull'elenco veicoli** (`GET /api/vehicles`, la
  vista board/ricerca, probabilmente la rotta a più traffico
  dell'app): restituiva anche `stimaIA` (JSON dell'analisi IA) e
  `firmaConsegnaDataUrl` (firma come immagine base64) per ogni riga,
  campi usati solo nella vista di dettaglio (verificato nel frontend:
  `VehicleDetailModal` fa una chiamata separata a `GET
  /api/vehicles/:id`, che li restituisce comunque). Rimossi con `omit`
  dalla sola vista elenco.
- **Verificato ma NON toccato** `GET /api/quotes`: l'audit iniziale
  segnalava `firmaDataUrl` come possibile peso inutile nell'elenco, ma
  il frontend lo usa davvero lì (`PreventiviView` apre l'anteprima
  firma direttamente dalla riga della lista, senza una seconda
  chiamata) — toglierlo avrebbe rotto quella funzione. Verificare nel
  frontend prima di tagliare un campo, non solo nel backend.
- **Elenco appuntamenti senza range di date** (`GET /api/appointments`
  senza `from`/`to`): restituiva l'intero storico del tenant, che
  cresce senza limite nel tempo. In pratica il calendario del frontend
  passa sempre un range, quindi non è (ancora) un problema osservato in
  produzione — ma un consumatore futuro dell'API che dimenticasse il
  range avrebbe scaricato tutto. Ora, senza range esplicito, risponde
  con una finestra di -30/+60 giorni intorno a oggi, più un `take:2000`
  come rete di sicurezza comunque.
- **Indice mancante**: `Appointment` aveva solo `@@index([tenantId])`,
  ma sia la vista calendario sia il controllo disponibilità tecnici
  filtrano per `tenantId` + range su `inizio` — aggiunto
  `@@index([tenantId, inizio])`.

## Verificato e già a posto (nessuna modifica necessaria)

- **Compressione immagini**: ogni foto caricata genera sempre un'anteprima
  compressa (2400px, JPEG qualità 85) tramite `sharp`, ed è quella —
  mai l'originale a piena risoluzione — a essere servita in liste,
  dettaglio e portale cliente. L'originale è usato solo internamente
  per l'analisi IA.
- **Dashboard ed executive summary**: tutte le query sono già
  parallelizzate con `Promise.all`/`$transaction` (non in sequenza), e
  usano `select` mirati invece di scaricare righe intere non necessarie.
- **Frontend**: file HTML singolo senza build step (React/Babel
  caricati da CDN, trascritti in JSX a runtime nel browser) — "bundle
  size" nel senso classico non si applica: non c'è nulla da impacchettare.

## Deliberatamente NON fatto ora (da valutare se/quando serve davvero)

- **Cache** (Redis o in-memory): oggi non esiste alcun livello di cache
  nell'app. A questa scala (poche query economiche per richiesta) non è
  stata aggiunta: introdurrebbe complessità (invalidazione, coerenza
  multi-tenant) per un beneficio oggi marginale. Se in futuro il
  traffico o il volume dati cresce, i candidati naturali sono
  `/api/dashboard/summary` ed `/api/executive` (aggregati che cambiano
  lentamente rispetto alla frequenza con cui vengono richiesti).
- **Ricerca testuale con indice trigram (`pg_trgm`)**: le ricerche
  `contains`/`insensitive` su targa/VIN/numero sinistro (veicoli), su
  nome/cognome/email (clienti) e su codice/descrizione (ricambi) non
  sono assistite da un indice dedicato — oggi eseguono una scansione
  ristretta al singolo tenant (poche centinaia di righe al massimo),
  economica. Diventerebbe utile un indice GIN con l'estensione
  Postgres `pg_trgm` se i volumi per tenant crescessero di molto — non
  attivata ora perché richiede abilitare un'estensione a livello di
  database, un intervento a sé.
- **Paginazione completa su tutte le liste**: oltre ad appuntamenti,
  altre liste "storiche" (messaggi WhatsApp per veicolo, azioni portale
  cliente) crescono nel tempo senza un limite esplicito. Non ancora un
  problema osservato alla scala attuale (storico di un singolo veicolo,
  non dell'intero tenant) — il pattern da riusare quando servirà è già
  in `src/routes/notifiche.js` (paginazione a cursore).
