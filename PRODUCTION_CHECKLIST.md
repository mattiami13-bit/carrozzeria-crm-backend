# Checklist prima di ogni deploy in produzione

Stato verificato il 17/09/2026 (punto 45). Questa è la checklist
**ricorrente**, da seguire prima di ogni singolo deploy — non va
confusa con [CHECKLIST_GO_LIVE.md](CHECKLIST_GO_LIVE.md) (punto 46),
che è una fotografia **una tantum** per decidere se il prodotto è
pronto a essere venduto pubblicamente per la prima volta. Questa qui è
più piccola apposta: è quella seguita, in pratica, prima di ogni
singolo push di questa sessione.

## Prima di scrivere la migrazione (se lo schema cambia)

- [ ] La modifica è in `prisma/schema.prisma` + un file di migrazione
      versionato in `prisma/migrations/` — mai una modifica diretta al
      database. Vedi [MIGRATIONS.md](MIGRATIONS.md).
- [ ] Se la migrazione è distruttiva (elimina/trasforma dati):
      `npm run prisma:check-distruttive` eseguito e la checklist
      backup/compatibilità/rollback seguita per davvero, non solo letta.
- [ ] RLS abilitata nella stessa migrazione, per ogni tabella nuova.

## Prima di committare

- [ ] Suite di test completa: tutti i file `tests/*.test.js` passano
      (`node --test tests/<file>.test.js` per ciascuno, o in batch).
      Nessun mock: se un test tocca email/Storage/Stripe, verifica che
      lo faccia con il servizio reale (o lo disattivi esplicitamente
      per non produrre effetti reali durante il test — vedi
      `delete process.env.RESEND_API_KEY` all'inizio dei file che
      toccano email, convenzione stabilita dopo aver scoperto che i
      test stavano mandando email vere).
- [ ] Se il frontend (`carrozzeria-crm-app.html`) è cambiato: mirror
      copiato in `frontend/` e `node tests/check-frontend.cjs` passa.
- [ ] **Il server si avvia davvero**: `node src/index.js` in locale,
      nessun errore all'avvio. Non basta che i test passino — un
      errore di sintassi o un export mancante in un file mai importato
      da nessun test (è successo, punto 40: un refactoring aveva
      cancellato per errore `export const assistenteRouter`) blocca
      l'intero avvio del processo in produzione senza che nessun test
      lo rilevi.
- [ ] Se sono state usate risorse reali per verificare (tenant, righe,
      file su Storage, sessioni Stripe di test): ripulite.

## Dopo il push

- [ ] Attendere il deploy Railway, poi verificare `GET /health` (deve
      rispondere `ok: true`, non solo 200 — controlla davvero il
      database, non risponde sempre ok).
- [ ] Verificare dal vivo, con una chiamata reale (non solo leggendo il
      codice), che la funzionalità appena aggiunta risponda come
      atteso in produzione — stesso standard usato per ogni punto di
      questa sessione.

## Perché questa lista esiste

Non è teorica: ogni singola voce qui sopra corrisponde a un problema
reale trovato durante questa stessa sessione di lavoro (email vere
inviate dai test, un bug di avvio mai rilevato dai test, un difetto
CORS che rispondeva 500 invece di 403, una tabella creata senza RLS).
La lista cresce quando succede qualcosa che avrebbe dovuto essere
catturato prima del deploy, non prima.

## Documenti correlati

[MIGRATIONS.md](MIGRATIONS.md) · [TESTING.md](TESTING.md) ·
[PRODUCTION.md](PRODUCTION.md)
