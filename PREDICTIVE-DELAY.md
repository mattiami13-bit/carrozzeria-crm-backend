# Predictive Delay AI

## Funzioni

Scheda in ogni pratica/veicolo e sinistro collegato, dashboard dedicata e collegamento al Copilot. ADMIN, AMMINISTRAZIONE e ACCETTATORE possono inserire ore/dipendenze e registrare decisioni. TECNICO vede solo le previsioni dei veicoli assegnati e non può modificarle; configurazione calendario riservata ad ADMIN. I ruoli vengono riletti sul server. Ore del Profit Tracker utilizzate senza esporre importi economici. FK di tecnici e ordini validate sul tenant.

Configurare nel menu Predictive Delay AI i giorni di apertura, le ore, i tecnici e reparti, le assenze, festività e chiusure. I giorni lunedì–venerdì sono una proposta non attiva fino alla conferma. Nessun calendario nazionale o patronale viene presunto. Nel piano pratica inserire ore previste/completate per tutti e quattro i reparti (zero esplicito per reparti non necessari), oppure selezionare le ore del Profit Tracker; la finitura resta operativa/manuale. In Profit Tracker il budget deve essere completo e le ore reali devono essere registrate: assenza di costi non equivale a zero ore completate.

Collegare singole voci degli ordini alla pratica: stato e ETA seguono quantità ricevute e data prevista dell’ordine. Nessun collegamento per somiglianza di nome. Le dipendenze manuali coprono anche lavorazioni esterne. Un ricambio senza ETA o con ETA scaduta impedisce una nuova data numerica fino alla verifica. L’arrivo è assunto dalla data ETA come giorno di disponibilità, non da un orario di consegna del fornitore.

## Modello v1

Indice euristico spiegabile 0–100, non modello addestrato né probabilità calibrata. Verde <=30; arancio 31–60; rosso >=61. Nessun valore se manca una base sufficiente; 100 con promessa già superata è un ritardo osservato, distinto da una previsione. Calendario Europe/Rome e promesse trattate per giorno locale (non appuntamento a un’ora specifica).

Le fasi dei reparti sono trattate in sequenza: carrozzeria, meccanica, verniciatura, finitura. Capacità limitata alle ore per vettura al giorno e ai tecnici configurati/attivi. Le assenze e gli appuntamenti riducono la capacità; sovrapposizioni conteggiate una volta. Gli appuntamenti di vetture già rappresentate da ore complete non sono sottratti nuovamente. Il tecnico assegnato limita il suo reparto alla propria disponibilità.

La coda precede la pratica in ordine di data promessa, ingresso e ID. Non è una pianificazione ottimizzata: include prudenzialmente la coda al momento in cui si raggiunge il reparto. Il carico visualizzato confronta ore note in coda + pratica con la capacità dei prossimi cinque giorni aperti. Pratiche senza ore complete vengono indicate come carico ignoto, mai considerate certe a zero.

Con ore mancanti, almeno cinque vetture concluse nello stesso stato permettono un fallback sulla mediana dei giorni calendario residui, considerando il tempo già trascorso nello stato. Campioni solo della carrozzeria, non successivi alla previsione, una osservazione per veicolo; massimo 5000 transizioni storiche più recenti. Nessuna inferenza di ore da prezzi preventivo. Senza ore e senza storico sufficiente non viene inventata una durata.

Punteggio base = round(50 + 45*tanh(scostamento giorni/2)); +8 se carico >90%, +8 se permanenza nello stato oltre mediana, +2 per dato mancante fino a +10; limite 99 per previsioni. Fattori e contributi sono salvati e mostrati. Questo punteggio serve a prioritizzare i controlli, non a certificare probabilità.

## Storico e decisioni

Snapshot con input operativi, risultato, promessa originale, versione algoritmo e timestamp. Identico input nello stesso intervallo di 15 minuti non crea duplicati. Prima previsione conservata; le successive non la sovrascrivono. Un worker nel backend ricalcola ogni 15 minuti per carrozzerie che hanno almeno un piano o calendario; anche apertura scheda e salvataggio aggiornano la valutazione. Il worker richiede un processo backend attivo. Nessun servizio esterno IA a pagamento è richiesto per questo motore.

KEEP registra la scelta; REVISE registra una previsione interna e non modifica Vehicle.dataPrevistaConsegna; DRAFT registra solo una bozza. WhatsApp si apre esclusivamente su click dell’operatore, con prefisso internazionale già presente in anagrafica; il messaggio va controllato e inviato da lui. Non viene marcato come inviato perché l’apertura di WhatsApp non ne prova l’invio.

Un trigger database registra la data effettiva nelle previsioni quando uno qualsiasi dei flussi di consegna la aggiorna; include il caso concorrente di creazione previsione e consegna. Eventuali correzioni alla data reale aggiornano l’esito, non gli input né la promessa originale. Le nuove tabelle hanno RLS attiva senza accesso pubblico.

Accuratezza: prima previsione numerica per veicolo prima della consegna, non oltre il giorno della promessa. Misura classificazione rosso/ritardo reale, errore assoluto medio della data, frequenza reale dei ritardi per fascia. Esclude previsioni create a posteriori; campione osservazionale senza garanzia di calibrazione né aggiustamento per interventi dell’operatore. Anche data promessa e data reale sono valutate sul giorno Europe/Rome. Una prima valutazione senza numero resta nello storico ma non entra nelle metriche.

## Verifica e avvio

`npm run test:delay`: motore, calendari/ETA/ore mancanti, API, tenant, permessi correnti, versioni e conservazione promessa. `npm run test:profit`: regressioni del modulo esistente. `node tests/delay-db.mjs`: prova transazionale sul database configurato con rollback totale, nessun dato test persistente e nessuna notifica.

`node tests/preview-delay.mjs` espone solo un test UI con API simulate su 127.0.0.1:4311. Non usa dati CRM e non salva sul database. L’anteprima reale usa PORT=4310, CRM_PREVIEW=1 e `node src/index.js`, URL http://127.0.0.1:4310/crm/carrozzeria-crm-app.html. Applicare la migrazione additiva e generare il client Prisma prima dell’avvio. Pubblicazione internet definitiva rimandata alla fine delle implementazioni richieste.
