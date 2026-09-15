# Backup e Disaster Recovery

Stato reale verificato il 15/09/2026 direttamente nei pannelli di controllo
(Supabase, Railway, GitHub). Nessuna voce di questo documento è dichiarata
"attiva" senza averla controllata di persona — se qualcosa qui sotto risulta
disattivato, è perché lo è davvero, non un'omissione.

## Cosa c'è da proteggere

| Dato | Dove vive |
|---|---|
| Database (clienti, veicoli, preventivi, utenti, tutto tranne le foto) | Postgres su Supabase |
| Foto veicoli (file binari) | Supabase Storage, bucket `vehicle-photos` (privato) |
| Documenti (portale cliente, ricambi, foto auto sostitutive) | Righe `bytea` nel database stesso (non su Storage) — quindi **coperti dal backup del database** |
| Codice applicativo, migrazioni, configurazione | Repository GitHub (`mattiami13-bit/carrozzeria-crm-backend`) |
| Variabili d'ambiente / segreti | Railway (variabili del servizio) |
| Dominio / DNS | Register.it |

Nota importante: i documenti (`PortalDocument`, `TrackedPartDocument`,
`LoanerCarPhoto`, `LoanerBookingPhoto`, `QcNonConformita.fotografia`) sono
salvati come byte direttamente nelle tabelle Postgres, **non** su Supabase
Storage — quindi il backup del database li copre per intero. Solo le foto
del veicolo caricate dal modulo principale (`Photo.url`) vivono su Storage
e sono l'unica categoria di dati NON coperta dal backup automatico (vedi
sotto).

## Database (Postgres / Supabase) — backup automatico ATTIVO

Verificato in Supabase → Database → Backups:

- **Backup giornalieri automatici**: sì, attivi. Snapshot fisico completo
  del database una volta al giorno (intorno a mezzanotte, fuso orario della
  region del progetto — `eu-central-1`).
- **Retention**: piano Pro, 5 backup visibili al momento del controllo
  (11–15 settembre 2026, il progetto è recente); la retention standard del
  piano Pro è di 7 giorni a rotazione.
- **Point-in-Time Recovery (PITR)**: **DISATTIVATO**. È un add-on a
  pagamento separato, non abilitato oggi. Senza PITR, in caso di
  ripristino si può tornare solo allo snapshot della notte precedente, non
  a un istante preciso della giornata (es. "10 minuti prima dell'errore").
- **Restore**: dalla stessa pagina, pulsante "Restore" su ciascuno
  snapshot. Supabase esegue il ripristino sul progetto stesso (non serve
  crearne uno nuovo), con un tempo di inattività durante l'operazione.
  Esiste anche l'opzione "Restore to new project" (in beta) per ripristinare
  su un progetto separato senza toccare quello in produzione — utile per
  verificare un backup senza rischi prima di un ripristino reale.

## Foto veicoli (Supabase Storage) — backup automatico NON ATTIVO

Verificato: Supabase stessa segnala esplicitamente che **i backup del
database non includono gli oggetti dello Storage** (il database contiene
solo i metadati/URL, non i file). Non esiste oggi alcun meccanismo di
backup automatico configurato per il bucket `vehicle-photos`.

**Questo è un rischio reale e concreto**, non teorico: sono le fotografie
dei danni e delle lavorazioni, con valore probatorio/assicurativo. Se il
bucket venisse svuotato per errore o corrotto, quelle foto sarebbero perse
in modo definitivo, senza possibilità di recupero.

Non è stata costruita una soluzione automatica in questa sessione — farlo
bene (copia periodica su un secondo bucket/provider, con la sua stessa
retention da gestire) è un intervento a sé, non improvvisato in coda ad
altro lavoro. Mitigazioni possibili da valutare, in ordine di sforzo
crescente:
1. Abilitare il versioning/backup nativo se Supabase lo introduce per lo
   Storage (al momento non disponibile su questo piano).
2. Script pianificato che copia periodicamente il bucket su un secondo
   bucket Supabase o su un provider diverso (Cloudflare R2, Backblaze B2).
3. Regola di retention "soft-delete" lato applicazione (non cancellare mai
   fisicamente una foto, solo nasconderla) come ulteriore rete di sicurezza
   indipendente dal backup infrastrutturale.

## Codice, migrazioni, configurazione

- **Codice e migrazioni database**: versionati su GitHub
  (`mattiami13-bit/carrozzeria-crm-backend`). Ogni commit è di per sé un
  backup del codice a quel punto nel tempo; `git log`/`git revert`
  permettono di tornare a qualunque versione precedente.
- **Variabili d'ambiente / segreti**: vivono solo nelle variabili del
  servizio Railway (mai nel codice, vedi punto 20). Railway non le
  versiona con uno storico consultabile: se vengono modificate o
  cancellate per errore, non c'è un "annulla" automatico. Consigliato
  conservare una copia offline aggiornata (es. gestore password) dei
  valori realmente in uso in produzione, non solo dei nomi in
  `.env.example`.
- **Applicazione (Railway)**: senza stato persistente proprio (nessun
  database Railway in uso: il database è su Supabase). Un disastro lato
  Railway si risolve ricreando il servizio dal repository GitHub e
  reinserendo le variabili d'ambiente — non richiede un "restore" nel
  senso classico perché non c'è nulla di stateful da recuperare lì.
- **Dominio (Register.it)**: i record DNS attuali sono documentati in
  questa sessione di lavoro (CNAME `www.rifless.it` → Railway, oltre ai
  record email preesistenti). Nessun backup automatico dei record DNS:
  in caso di cancellazione accidentale andrebbero ricreati manualmente
  seguendo la configurazione nota.

## Procedura di ripristino (disaster recovery) — passo per passo

### Scenario A: dati corrotti/cancellati per errore nel database

1. Supabase → Database → Backups → Scheduled backups.
2. Valutare prima con **"Restore to new project"** (beta) per verificare
   che lo snapshot contenga davvero i dati attesi, senza toccare la
   produzione.
3. Solo dopo la verifica, eseguire il "Restore" sul progetto reale.
4. Aggiornare `DATABASE_URL`/`DIRECT_URL` su Railway se il restore genera
   nuove credenziali di connessione (da verificare al momento, dipende da
   come Supabase gestisce il restore in-place).
5. Riavviare il servizio Railway e verificare `/health` e un login di
   prova.

### Scenario B: servizio Railway cancellato o irrimediabilmente rotto

1. Creare un nuovo servizio Railway collegato allo stesso repository
   GitHub (`mattiami13-bit/carrozzeria-crm-backend`, branch `main`).
2. Reimpostare tutte le variabili d'ambiente (usare la copia offline
   raccomandata sopra, o recuperarle da un'altra fonte se disponibile).
3. Ricreare il dominio personalizzato `www.rifless.it` (Networking →
   Custom Domain) e aggiornare il record CNAME su Register.it se il nuovo
   servizio genera un target diverso (è successo già una volta in questa
   sessione: ogni dominio personalizzato ha un target CNAME univoco).
4. Verificare `/health`, login, upload foto e webhook Stripe/Twilio (il
   webhook secret e gli URL configurati lato Stripe/Twilio potrebbero
   dover essere aggiornati se cambia l'URL pubblico).

### Scenario C: bucket foto (`vehicle-photos`) svuotato o corrotto

Oggi **non recuperabile** oltre a quanto eventualmente presente nella
cache del browser dei client o in copie locali sui dispositivi di chi ha
scattato le foto. Questo è esattamente il rischio descritto sopra — motivo
per cui è segnalato come priorità, non solo annotato.

## Cosa NON è vero (per essere onesti fino in fondo)

- Non esiste oggi un backup automatico delle foto veicolo.
- Non esiste Point-in-Time Recovery sul database (solo snapshot giornalieri).
- Non è mai stato eseguito un vero test di restore end-to-end in questa
  sessione (verificare che un ripristino funzioni davvero, prima di
  averne bisogno per un'emergenza reale, richiederebbe eseguire il
  restore su un progetto Supabase separato — non fatto qui: comporterebbe
  costi e tempo di configurazione che vanno decisi esplicitamente, non
  presunti in autonomia).
