# Executive Dashboard

Dashboard di sola lettura per ADMIN, verificato dal ruolo attuale dell'account attivo nel database (non soltanto dal JWT). Il menu Dashboard preesistente rimane disponibile; Executive è la vista iniziale degli amministratori.

## Periodi e dettagli

Oggi, settimana da lunedì, mese, trimestre, anno e periodo personalizzato di massimo 366 giorni. Calendario Europe/Rome, inclusi cambi ora. I periodi predefiniti terminano oggi; confronto con intervallo precedente di pari giorni, alla stessa ora circa per il giorno in corso. La data di origine è spiegata in ogni indicatore.

Ogni KPI e fase del percorso apre le righe di origine, con collegamento alla pratica. Per somme, medie e percentuali vengono mostrate le rispettive basi di calcolo. Preventivi e lavorazioni possono produrre più righe per la stessa pratica; il pannello indica anche il numero di pratiche distinte.

## Fonti e formule

- Entrate: Vehicle.dataIngresso. Consegnate: dataConsegnaEffettiva, oppure evento CONSEGNATA dello storico.
- Tempo riparazione: intervallo ingresso-consegna delle consegne nel periodo, in giorni di calendario, comprese attese e chiusure.
- Margine operativo: Profit Tracker per data di competenza, ricavi previsti meno costi reali registrati (inclusi Parts Tracking), IVA esclusa. La percentuale è ponderata sui ricavi, non media delle percentuali. Non è utile netto. Registri mancanti/incompleti segnalati.
- Ticket medio lavori: ricavo previsto delle pratiche consegnate, da Profit Tracker o unico preventivo accettato. Più preventivi accettati senza un riferimento esplicito non vengono sommati arbitrariamente.
- Ore lavorate: WorkOrderTimeEntry limitati all'intervallo, inclusi timer aperti fino all'istante di lettura. Sovrapposizioni dello stesso tecnico ripartite tra lavorazioni simultanee, così il tempo non è duplicato.
- Produttività standard/reale: oreStimate delle lavorazioni terminate nel periodo / ore reali dell'intero ciclo delle medesime lavorazioni. Non rappresenta ore vendute o presenza del personale. Lavorazioni prive di timer sono segnalate come mancanti.
- Capacità utilizzata: ore timer dei tecnici inclusi nel calendario / disponibilità programmata nel DelaySettings confermato, con turni, chiusure e assenze. Non misura le presenze effettive. Confronto storico disabilitato perché il calendario non è versionato.
- Vetture ferme per ricambi: intervalli VehiclePartBlock aperti al termine del periodo, non sola fase ORDINE_RICAMBI.
- Ferme/in attesa: blocchi ricambi, sole lavorazioni in pausa, oppure attesa approvazione. Ricostruzione tramite storico alla fine dell'intervallo; stati non ricostruibili segnalati.
- Ritardo: vetture attualmente aperte con giorno promesso scaduto. Periodi storici e trend non disponibili perché la data promessa non è versionata.
- Preventivi aperti: BOZZA/INVIATO creati nel periodo, nello stato attuale.
- Approvazione: ACCETTATO / non BOZZA creati nel periodo, nello stato attuale. Confronto per coorti, con possibili decisioni ancora pendenti.
- Lavori in corso: ricavi previsti delle pratiche aperte attualmente. Non valore contabile delle rimanenze; storico economico non disponibile.
- Fatturato, incassi, crediti: non disponibili finché non esistono registri contabili effettivi. Nessun preventivo è presentato come fattura o pagamento.
- Ore vendute: non disponibili perché QuoteItem.quantita non ha un'unità esplicita; MANODOPERA non viene interpretata arbitrariamente come ore.

## Percorso

Preventivato → Approvato → In lavorazione → Completato → Fatturato → Incassato. Coorte delle vetture entrate nel periodo, fasi documentate raggiunte fino a oggi. Non è una somma di ricavi tra fasi e non forza transizioni prive di prove. Importi ambigui sono indicati come mancanti; fatturato/incassato rimangono non disponibili.

## Implementazione e verifiche

GET /api/executive?period=MESE; query di sola lettura in snapshot RepeatableRead, tenant in ogni fonte. Nessuna modifica allo schema o ai dati CRM.

`npm run test:executive`: 8 test su periodi/DST, timer, margini ponderati, preventivi multipli, dati mancanti, fermi, capacità e permessi. `node tests/executive-db.mjs`: verifica query, isolamento tenant, timer e drill-down in transazione completamente annullata. JSX compilato e controllato con `node tests/check-frontend.cjs`.

La verifica visiva nel browser è rimasta bloccata dal controllo automatico per crediti dello spazio di lavoro esauriti. Nessun aggiramento del blocco.
