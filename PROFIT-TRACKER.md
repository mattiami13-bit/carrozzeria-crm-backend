# Profit Tracker

Scheda disponibile nei dettagli veicolo/pratica e nei sinistri con veicolo collegato. La stessa riparazione mantiene un solo registro: aprirla dal sinistro non duplica il ricavo. Dashboard nella navigazione per ADMIN e AMMINISTRAZIONE. Solo ADMIN cambia soglie; verifica del ruolo corrente anche sul server e nel Copilot.

## Contabilità e completezza

Tutti gli importi sono IVA esclusa. Importi memorizzati in centesimi interi, costi = quantità/ore × tariffa con arrotondamento al centesimo per riga. Il ricavo usa alternativamente il preventivo selezionato (imponibile aggiornato) o manuale, oppure le quote assicurazione + cliente; aggiunge integrazioni, lavori aggiuntivi e altri ricavi una sola volta. Le quote pagatore non si sommano al preventivo. Inserire esplicitamente zero quando una quota non è dovuta; vuoto significa sconosciuto.

Il margine reale confronta il ricavo previsto con i costi registrati, non certifica fatturato, incassi o utile netto. Finché budget/costi non sono confermati completi l’indicatore è provvisorio. Modificare una voce costo toglie la conferma di completezza. Mancano collegamenti pratica nei movimenti magazzino e nelle timbrature preesistenti: nessun costo viene dedotto per somiglianza di descrizione o inventato; l’operatore registra i costi effettivi nel nuovo registro.

Scostamento = costo previsto − costo reale; un numero negativo è erosione del margine. Tabella categorie ordinata dai maggiori sforamenti. Costi reali e previsti permettono molteplici voci con date e descrizioni. Salvataggio esplicito con controllo versione evita sovrascritture tra operatori. La dashboard e le schede senza modifiche si aggiornano ogni 30 secondi; l’anteprima durante le modifiche è immediata.

## Dashboard

Giorno, settimana da lunedì, mese, anno usano la data di competenza impostata nella scheda (inizialmente data ingresso Europe/Rome). I filtri data includono entrambi gli estremi. Le altre dimensioni sono tecnico attualmente assegnato al veicolo, assicurazione del veicolo (o unica assicurazione nei sinistri collegati), tipologia della riparazione. Non si attribuiscono margini personali alle singole ore. Se più assicurazioni sono presenti e il veicolo non ne specifica una, il gruppo è “Più assicurazioni”. Le percentuali si calcolano dai totali, mai dalla media delle percentuali. Pratiche non compilate sono conteggiate come escluse; un ricavo sconosciuto rende non disponibile il margine aggregato. Dati correnti, non snapshot storici.

## Attivazione e verifica

Migrazione additiva `20260913190000_profit_tracker`, senza cancellare o riscrivere tabelle esistenti. Usa `prisma migrate deploy`, mai reset o db push. Generare il client Prisma prima dell’avvio. Le nuove tabelle hanno RLS attiva senza policy pubbliche; accesso tramite backend autenticato. Verificare che l’utenza database del backend abbia i privilegi previsti come per gli altri moduli.

`npm run test:profit` verifica esempio economico, dati mancanti, doppio conteggio, tariffe frazionarie, soglie, aggregazioni ponderate, date/settimane, permessi correnti, tenant, preventivi estranei e conflitti. Le API usano un database simulato isolato; nessun messaggio, costo o dato cliente reale viene creato dai test. `tests/check-frontend.cjs` compila il JSX con il trasformatore già presente nelle dipendenze di Prisma.

Frontend versionato: `frontend/carrozzeria-crm-app.html`; copia desktop aggiornata e backup `carrozzeria-crm-app (15).before-profit.html`. Anteprima locale: impostare PORT=4310 e CRM_PREVIEW=1, avviare il backend e aprire http://127.0.0.1:4310/crm/carrozzeria-crm-app.html. Solo questa origine usa API locali. Nessuna pubblicazione finale del gestionale è inclusa in questo aggiornamento.
