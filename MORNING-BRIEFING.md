# AI Morning Briefing ed Evening Summary

Il pannello è in cima alla Executive Dashboard del titolare/amministratore. Il ruolo ADMIN attivo viene verificato dal database ad ogni richiesta; tutte le letture sono limitate alla carrozzeria autenticata. Le nuove tabelle hanno RLS abilitata e sono accessibili attraverso il backend autenticato, non tramite il client Supabase pubblico.

La mattina è abilitata alle 08:00, Europe/Rome. La sera è opzionale, inizialmente disabilitata, con orario proposto 18:30. Gli orari sono modificabili dal pannello. Il worker controlla ogni minuto e salva un solo report per carrozzeria, giorno e tipo; il vincolo univoco impedisce duplicati anche con più processi. Gli errori vengono ritentati. I report salvati sono immutabili e gli ultimi 30 sono consultabili nel pannello.

Il server deve restare in esecuzione per generare i briefing a CRM chiuso. Al riavvio recupera solo la giornata corrente e conserva l'ora reale della rilevazione: non ricostruisce retroattivamente la situazione delle 08:00. `BRIEFING_WORKER=0` disabilita il worker per ambienti di test. Aprire il pannello recupera anche il report eventualmente mancante. La situazione corrente viene riletta ogni cinque minuti mentre il pannello è aperto, senza alterare gli snapshot.

L'analisi è deterministica e spiegabile, senza chiamate a un modello generativo né cifre simulate:

- Vetture aperte, consegne promesse oggi/scadute e consegne di domani: stato e date della pratica.
- Rischio alto: indice >60 del Predictive Delay AI, stessa data promessa e previsione non più vecchia di 30 minuti. Previsioni assenti/scadute vengono dichiarate; l'indice non è una probabilità calibrata.
- Ferme per ricambi: condizioni del Parts Tracking, vetture contate una sola volta. Le raccomandazioni distinguono ordini, ETA, controlli e blocchi.
- Preventivi non approvati: BOZZA o INVIATO con imponibile strettamente maggiore di 3.000 euro, su pratiche aperte.
- Ore in eccesso: lavorazioni non completate con timer reali superiori alla stima. Timer aperti inclusi; intervalli simultanei dello stesso tecnico ripartiti per evitare duplicazioni.
- Carico domani: ore residue delle lavorazioni con scadenza entro domani, confrontate con calendario confermato, tecnici attivi, assenze, chiusure e appuntamenti. Non equivale a una pianificazione completa; lavorazioni senza scadenza sono dichiarate ed escluse. Nessuna percentuale inventata quando la capacità è zero o sconosciuta.
- Sera: eventi TERMINATA per lavori tuttora completati, date di consegna effettiva, problemi ancora rilevati, consegne del mattino tuttora aperte, situazione di domani. In assenza di snapshot mattutino il confronto è non disponibile.

APRI, VERIFICA, CONTATTA e ASSEGNA aprono la pratica: l'operatore gestisce l'azione nei moduli già esistenti. Il briefing non invia messaggi, non assegna lavori e non modifica date. RISOLVI è disponibile sui report salvati e richiede nota e conferma; registra autore e ora della gestione senza cambiare la pratica. Una condizione persistente resta visibile nel briefing corrente e nei giorni successivi.

Validazione: `tests/briefing.test.js`, `tests/briefing-api.test.js`, compilazione JSX e controllo `tests/briefing-db.mjs` (transazione annullata integralmente). Per il blocco preesistente della migrazione auto sostitutive è stato corretto il cast dell'enum e completata in transazione la parte mancante; `tests/verify-loaner-migration-recovery.mjs` ha verificato tutti i passaggi con 70 controlli prima della registrazione del completamento.
