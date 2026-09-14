# Parts Tracking

Modulo collegato a Vehicle (pratica) e accessibile anche dal sinistro. Dashboard nel menu Parts Tracking e riepilogo nella dashboard principale.

- Stati: DA_ORDINARE, ORDINATO, CONFERMATO, IN_TRANSITO, ARRIVATO, CONTROLLATO, MONTATO. Rettifiche, salti e annullamenti richiedono un motivo. Versione ottimistica e chiave di creazione idempotente.
- Dati: codice, descrizione, OEM/aftermarket, fornitore, quantità, prezzi unitari al netto IVA, date ordine/ETA/arrivo, documento e note, reso e credito effettivamente confermato.
- Gli ordini collegati alimentano ETA e ricezione completa. La data di arrivo storica assente non viene inventata. Gli avanzamenti manuali a ordinato/arrivato registrano la data corrente se mancante. Nessun doppio movimento di magazzino.
- Alert calcolati dai dati e aggiornati all'apertura e ogni 60 secondi: da ordinare, ETA superata, prezzo unitario superiore al previsto, arrivato non controllato, blocco vettura.
- Fermo fisico dichiarato dall'operatore con apposita casella. Intervalli serializzati con lock sulla vettura e un solo intervallo aperto, indipendentemente dal numero di ricambi. Giorni di 24 ore comprese notti/chiusure; nessuna ricostruzione fittizia del passato. Chiusura al controllo di tutti i ricambi bloccanti, rimozione blocco o consegna. Un reso in attesa di sostituzione può mantenere/riaprire il fermo.
- Il workflow Ordine ricambi senza un fermo tracciato compare come situazione da verificare, senza attribuirgli giorni di blocco causale.

## Profit Tracker e altri moduli

Costi derivati in lettura, mai copiati ripetutamente nel registro manuale. Quantità × prezzo unitario; i crediti dei resi confermati riducono il costo reale. Annullare un ricambio non cancella costi già sostenuti. Prezzi sconosciuti mantengono il riepilogo provvisorio.

Per costi già inseriti manualmente, l'amministrazione può collegare una specifica voce ricambi: l'originale rimane nel registro ma viene escluso dai totali quando il costo tracciato è disponibile. Non esiste deduplicazione arbitraria per descrizione. Le voci cumulative vanno prima separate. Sono aggiornati anche dashboard aggregate, marginalità del Copilot e dipendenze del Predictive Delay.

## Accessi e conservazione

Tenant verificato su ogni accesso. Il ruolo attuale viene riletto dal database. Tecnici limitati alle proprie vetture e conferme sequenziali controllo/montaggio. Accettazione modifica dati operativi; ADMIN/AMMINISTRAZIONE accedono a prezzi, crediti e allegati. PDF/JPEG/PNG privati, massimo 5 MB e 10 documenti per ricambio, download autenticato. Nessun link pubblico ai documenti.

Tabelle additive tracked_parts, tracked_part_events, vehicle_part_blocks e tracked_part_documents con RLS. La rimozione dal catalogo/ordine scollega il riferimento senza cancellare lo storico della pratica. Non vengono inviate comunicazioni al cliente né effettuati acquisti.

## Verifiche

`npm run test:parts`; regressioni Profit e Delay: 30 test complessivi. `node tests/check-frontend.cjs` compila il JSX e confronta le formule. `node tests/parts-db.mjs` verifica il database in una transazione annullata integralmente, inclusi idempotenza, conflitti, permessi, documenti, costi, fermi multipli, consegna, ordini e cancellazione riferimenti.

`node tests/preview-parts.mjs` serve un test UI isolato su 4312 con componenti reali e API simulate, senza dati CRM. Verificati inserimento, avanzamento, alert e schermo 390 px. La versione reale locale è su http://127.0.0.1:4310/crm/carrozzeria-crm-app.html; pubblicazione online separata.
