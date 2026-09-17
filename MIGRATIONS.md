# Migrazioni database (punto 44)

Stato verificato il 17/09/2026: 37 migrazioni in `prisma/migrations/`,
dalla primissima (`20260727123041_init`) all'ultima applicata, tutte
versionate e già eseguite contro il database di produzione reale. Non
esiste, in tutta la storia di questo repository, una modifica allo
schema fatta a mano (SQL Editor di Supabase, `psql`, o `prisma db push`)
— ogni cambiamento è passato da un file di migrazione, mai
un'eccezione.

## Regola: mai modificare production manualmente

Ogni modifica allo schema segue sempre lo stesso percorso:

1. Modifica `prisma/schema.prisma`.
2. Scrivi (o genera con `prisma migrate dev` in locale) il file
   `prisma/migrations/<timestamp>_<nome>/migration.sql` corrispondente.
3. `npx prisma migrate deploy` — applica contro il database configurato
   in `DIRECT_URL` (connessione diretta, non il pooler di `DATABASE_URL`:
   le migrazioni hanno bisogno di una connessione che supporti i comandi
   DDL usati da Prisma, vedi `prisma.config.ts`).
4. `npx prisma generate` — rigenera il client, i cui file in
   `src/generated/prisma/` sono versionati anche loro.

Mai il contrario: nessuna riga in nessuna migrazione di questo progetto
è mai stata scritta guardando prima lo stato reale del database e
copiandolo indietro nello schema — sarebbe il modo in cui uno schema e
il database reale iniziano silenziosamente a divergere.

## Convenzioni già in uso (osservate, non solo dichiarate)

- **RLS abilitata alla creazione, non aggiunta dopo**: da quando un
  controllo di sicurezza reale (allerta Supabase Security Advisor su
  `stripe_webhook_events`, non prevista) ha rivelato una tabella senza
  Row Level Security, ogni migrazione che crea una tabella nuova
  include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nella STESSA
  migrazione — mai una migrazione separata "per dopo" che rischia di
  essere dimenticata.
- **Gli enum crescono, non si riducono**: ogni volta che è servito un
  nuovo stato (es. `ANNULLATA` su `GdprRichiestaStato`, punto 42), è
  stato aggiunto con `ALTER TYPE ... ADD VALUE`, mai rimosso o
  rinominato un valore esistente — rimuovere un valore enum già in uso
  romperebbe ogni riga che lo referenzia.
- **Le relazioni onDelete sono una scelta esplicita, mai il default
  implicito**: `CASCADE` dove la riga figlia non ha senso senza il
  genitore (es. override di un feature flag quando il tenant viene
  eliminato), `RESTRICT` dove cancellare andrebbe a perdere una storia
  che deve restare (es. l'utente che ha creato un ticket di supporto).

## Prima di una migrazione distruttiva

Il prompt chiede esplicitamente backup, verifica di compatibilità, e un
piano di rollback prima di una migrazione distruttiva (che elimina o
trasforma dati esistenti: `DROP COLUMN`, `DROP TABLE`, `TRUNCATE`, un
cambio di tipo, una colonna che diventa `NOT NULL`). Ad oggi nessuna
migrazione di questo progetto ha fatto niente del genere sui dati (l'unico
`DROP CONSTRAINT` esistente, in `20260914100000_parts_catalog_links`,
sostituisce un vincolo con uno diverso nella stessa migrazione, non
elimina dati) — ma la disciplina va rispettata dalla prossima volta che
servirà davvero, non solo quando è comodo.

`npm run prisma:check-distruttive` (o `prisma:migrate-deploy-sicuro`
per farlo scattare automaticamente prima del deploy vero) scansiona le
migrazioni non ancora applicate cercando questi pattern, ed espone la
checklist:

- **Backup**: Supabase esegue un backup automatico giornaliero (vedi
  [BACKUP-DISASTER-RECOVERY.md](BACKUP-DISASTER-RECOVERY.md)) — per una
  migrazione importante, verificane uno recente prima, non fidarti solo
  che "esiste in teoria".
- **Compatibilità**: il codice già in esecuzione in produzione (quello
  di PRIMA di questo deploy) deve continuare a funzionare contro lo
  schema nuovo per la finestra di tempo in cui entrambi coesistono —
  Railway non ferma il traffico durante un deploy. Per un cambiamento
  che altrimenti romperebbe questo, preferire due migrazioni separate
  nel tempo (pattern "expand/contract"): prima aggiungi la nuova
  colonna come nullable e fai coesistere il codice con entrambe,
  distribuisci il codice che la usa, poi — solo in una migrazione
  successiva, dopo che il nuovo codice è già ovunque — rendila
  obbligatoria o rimuovi la vecchia.
- **Rollback plan**: Prisma non genera mai una migrazione "down"
  automatica. Per una migrazione additiva il rollback è quasi sempre
  "nessuno serve" (una colonna in più non usata non rompe nulla). Per
  una migrazione distruttiva, il rollback reale è quasi sempre
  "ripristina il backup", non "riscrivi la migrazione al contrario" — e
  va deciso e scritto PRIMA del deploy, non improvvisato sotto
  pressione se qualcosa va storto.

Lo script non decide da solo se è sicuro procedere (non può sapere se
hai davvero controllato il backup): elenca solo cosa ha trovato e si
ferma finché non confermi esplicitamente con
`CONFERMA_MIGRAZIONE_DISTRUTTIVA=1`.
