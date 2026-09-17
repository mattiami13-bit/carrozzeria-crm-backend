# Multi-tenancy

Stato verificato il 17/09/2026 (punto 45).

## Modello

Ogni carrozzeria è un `Tenant`. Ogni tabella con dati di un cliente ha
una colonna `tenantId`, quasi sempre con un vincolo di chiave esterna
diretto verso `tenants` (non ereditato indirettamente tramite un'altra
relazione) — così l'isolamento è verificabile guardando la singola
tabella, non ricostruendo una catena di join.

## Come il tenant corrente viene determinato (mai dal client)

`requireAuth` (`src/middleware/auth.js`) decodifica il JWT e imposta
`req.auth = { userId, tenantId, role }` — il `tenantId` viene **sempre**
dal token firmato dal server al login, mai da un parametro URL, header
custom, o campo del body. Ogni route usa poi l'helper `tenantScope(req)`
per costruire il filtro Prisma (`{ tenantId: req.auth.tenantId }`),
incluso in ogni `findMany`/`findFirst`/`update`/`delete` operativo.

Due dettagli che rendono questo pattern robusto invece che solo
convenzionale:

- **`requireAuth` rifiuta un token senza `tenantId`**, esplicitamente,
  invece di limitarsi a non impostarlo. Motivo: Prisma tratta
  `where: { tenantId: undefined }` come "nessun filtro", non "nessun
  risultato" — un token senza `tenantId` (quello super-admin, punto 31)
  che finisse per errore su una rotta tenant-scoped restituirebbe i
  dati di TUTTI i tenant invece di un errore, se questo controllo non
  ci fosse.
- **Row Level Security** a livello Postgres su ogni tabella (vedi
  [SECURITY.md](SECURITY.md)) è una seconda barriera indipendente
  dall'applicazione — verificata empiricamente contro l'API REST
  pubblica di Supabase, non solo dichiarata.

## Cosa NON è scoped per tenant

Un numero piccolo e deliberato di tabelle/rotte sono di livello
piattaforma, non di un singolo tenant: `SuperAdmin`, `FeatureFlag` (con
override per singolo tenant in una tabella collegata), `FaqItem`,
`ChangelogEntry`, `Lead` (contatti/demo commerciali — un prospect non
ha ancora un tenant). Tutte protette da `requireSuperAdmin`, mai da
`requireAuth`+`tenantScope`.

## Stato dell'abbonamento e accesso

`requireAbbonamentoAttivo` (`src/middleware/subscription.js`), montato
su tutte le rotte operative ma non su auth/billing/GDPR/supporto
(altrimenti un tenant bloccato non potrebbe pagare per riattivarsi, né
esportare/cancellare i propri dati, né chiedere aiuto — vedi l'ordine
di montaggio in [ARCHITECTURE.md](ARCHITECTURE.md)):

- Blocca (402) se `subscriptionStatus` è `CANCELED`/`UNPAID`/`SUSPENDED`,
  o se il trial è scaduto.
- **`PAST_DUE` non blocca** — grace period deliberato: un pagamento
  fallito temporaneamente non deve interrompere subito il lavoro.
- Un tenant demo (`isDemo: true`) non è **mai** bloccato: non ha un
  vero abbonamento, bloccarlo per "trial scaduto" non avrebbe senso.
  Vedi [DEMO.md](DEMO.md).

## Eliminazione di un tenant

Mai immediata, mai automatica — vedi [SECURITY.md](SECURITY.md) e il
commento su `Tenant.eliminazioneRichiestaAt` in `schema.prisma`.

## Documenti correlati

[SECURITY.md](SECURITY.md) · [ARCHITECTURE.md](ARCHITECTURE.md) ·
[BILLING.md](BILLING.md) · [DEMO.md](DEMO.md)
