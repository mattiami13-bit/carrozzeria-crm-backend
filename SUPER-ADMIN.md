# Super-admin (punto 31)

Account di livello piattaforma, separato dagli utenti dei tenant, per chi
gestisce Rifless stesso (oggi: solo il proprietario del prodotto).

## Cosa esiste oggi

- Tabella `super_admins`, separata dalla tabella `users` (mai lo stesso
  modello — vedi "Perché un modello separato" sotto).
- `POST /api/super-admin/login` — email + password, restituisce un JWT
  valido 4 ore.
- `GET /api/super-admin/tenants` — elenco di tutte le carrozzerie con
  piano, stato abbonamento, se demo, e conteggi (utenti/clienti/veicoli).
  Nessun dato operativo (nessun cliente, veicolo, preventivo reale).
- `GET /api/super-admin/gdpr-richieste` — richieste GDPR (export,
  cancellazione account/cliente) in attesa, su tutti i tenant.
- Da qui in poi la lista è cresciuta punto dopo punto (lead commerciali,
  FAQ, changelog, feature flag, ticket di supporto, usage tracking,
  costo AI) — l'elenco completo e sempre aggiornato è
  `src/routes/superAdmin.js` stesso, non ripetuto qui per non
  disallinearsi nel tempo.

## Eliminazione account (punto 42)

Un ADMIN richiede la cancellazione della propria organizzazione da
Impostazioni → Privacy e dati → Elimina organizzazione: password +
conferma testuale (la ragione sociale esatta) portano il tenant in
stato PENDING_DELETION (`Tenant.eliminazioneRichiestaAt` non nullo),
con una data di scadenza del periodo di grazia
(`Tenant.eliminazionePrevistaPer`, `ACCOUNT_DELETION_GRACE_DAYS` giorni
dopo, default 30) — visibile anche a te tramite
`GET /api/super-admin/gdpr-richieste` (la nota della richiesta riporta
la data). Il tenant resta pienamente utilizzabile e la richiesta è
annullabile dall'organizzazione in qualsiasi momento prima di allora.

**Non esiste nessuna cancellazione automatica alla scadenza**, per
scelta deliberata: stesso principio già in vigore per la coda
`GdprRichiesta`, mai un'azione distruttiva su un intero tenant (tutti i
suoi dati operativi) senza un controllo umano. Dopo la scadenza del
periodo di grazia, se la richiesta è ancora `IN_ATTESA`, puoi eseguire
tu stesso l'eliminazione reale (oggi: manualmente, accedendo al
database — un'azione a sé, non ancora una rotta dedicata) sapendo che
il periodo promesso all'organizzazione è trascorso.

## Cosa NON esiste ancora

Non c'è un pannello (interfaccia grafica). Queste due rotte sono pensate
per essere chiamate da riga di comando (`curl`) o da un client HTTP
qualsiasi, non da un form nel gestionale. Un pannello vero — con
interfaccia, gestione tenant (sospendere, modificare piano manualmente),
elaborazione effettiva delle richieste GDPR, gestione di altri
super-admin — è un intervento a sé, non ancora pianificato in un punto
specifico del prompt.

## Creare il primo (e unico) super-admin

Procedura one-time, pensata per essere eseguita una sola volta in vita
del progetto:

```bash
SUPER_ADMIN_EMAIL=tuo@indirizzo.it node scripts/seed-super-admin.mjs
```

- Se non imposti `SUPER_ADMIN_PASSWORD`, lo script genera una password
  casuale sicura (~140 bit di entropia) e la stampa una sola volta a
  schermo: va salvata subito in un gestore password, non è recuperabile
  in nessun altro modo (è salvata solo come hash bcrypt nel database).
- Se imposti `SUPER_ADMIN_PASSWORD` tu stesso, deve avere almeno 16
  caratteri.
- Lo script si rifiuta di girare se esiste già un super-admin nel
  database — verificato: un secondo tentativo fallisce con un errore
  esplicito, per non crearne uno per sbaglio in produzione.
- Nessuna credenziale è mai scritta nel codice o in un file versionato:
  arrivano solo da variabili d'ambiente lette al momento dell'esecuzione.

Per aggiungere un secondo super-admin in futuro serve un intervento
manuale sul database (o, più avanti, una rotta dedicata protetta da
`requireSuperAdmin` — non ancora costruita): questo script è
deliberatamente one-time e non un meccanismo di invito.

## Login

```bash
curl -X POST https://www.rifless.it/api/super-admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}'
```

Il token va poi usato come `Authorization: Bearer <token>` sulle altre
due rotte.

## Perché un modello separato da `User` (e non un ruolo `SUPER_ADMIN`)

Il rischio concreto: Prisma tratta `where: { tenantId: undefined }` come
"nessun filtro", non come "nessun risultato". Se un token super-admin
fosse solo uno `User` con un ruolo speciale e nessun `tenantId`, e per
qualche bug finisse su una rotta protetta da `requireAuth` normale, il
filtro per tenant sparirebbe silenziosamente e la rotta restituirebbe i
dati di TUTTI i tenant invece di un errore.

Per questo:

- `SuperAdmin` è un modello Prisma a sé, con il proprio middleware
  (`requireSuperAdmin`, in `src/middleware/superAdmin.js`) che verifica
  il claim `superAdmin: true` nel JWT.
- Il JWT di un token utente normale e quello di un super-admin non sono
  intercambiabili: `requireAuth` (in `src/middleware/auth.js`) rifiuta
  esplicitamente qualsiasi token privo di `tenantId` — quindi un token
  super-admin non passa mai da una rotta tenant — e `requireSuperAdmin`
  rifiuta qualsiasi token privo del claim `superAdmin` — quindi un token
  utente normale non passa mai da una rotta super-admin.
- Entrambi i confini sono coperti da test automatici in
  `tests/super-admin.test.js` (non solo il "percorso felice" del login).

## Test

```bash
npm run test:super-admin
```

Verifica, con database reale (nessun mock): login con credenziali
corrette/sbagliate, super-admin disattivato, le due rotte di lettura, e
soprattutto i due confini di sicurezza sopra descritti.
