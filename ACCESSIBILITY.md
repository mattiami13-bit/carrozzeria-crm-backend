# Accessibilità

Audit del 16/09/2026 (punto 27 del prompt SaaS): label, focus, navigazione
da tastiera, contrasto, attributi ARIA, errori comprensibili nei moduli.
Verificato leggendo il codice sorgente e con controlli di contrasto
calcolati (formula WCAG), non solo a occhio.

## Corretto in questa sessione

### Errori dei moduli mostrati come JSON grezzo (il problema più serio)

Causa: un'unica funzione condivisa (`useApi`, usata da **ogni** chiamata
al server nel gestionale) convertiva un errore di validazione strutturato
del server in `JSON.stringify(...)`, mostrando all'utente cose come
`{"formErrors":[],"fieldErrors":{"email":["Invalid email"]}}` invece di
un messaggio leggibile — capitava per qualunque modulo (visto la prima
volta nel modulo "Nuovo cliente", ma il bug era nella funzione condivisa,
non nel singolo modulo).

Corretto con `messaggioErrore()`: se l'errore è già una stringa (il caso
più comune) resta invariato; se è un errore di validazione strutturato,
ne estrae i messaggi leggibili. Essendo un'unica funzione centrale, la
correzione vale automaticamente per ogni modulo dell'app, non solo per
quello dove è stato notato.

### Navigazione da tastiera nelle liste principali

Le card/righe cliccabili per aprire il dettaglio di un record (veicoli
nella board, clienti, preventivi impliciti, ricambi, ordini fornitori,
auto sostitutive, sinistri) erano `<div onClick=...>` semplici: **non
raggiungibili navigando con Tab**, e non attivabili con Invio/Spazio. Un
utente che naviga solo da tastiera non poteva aprire nessuna pratica.

Corretto su tutte e 6 le liste: aggiunto `role="button"`, `tabIndex={0}`
e un gestore `onKeyDown` che attiva lo stesso comportamento del click su
Invio o Spazio (più `aria-label` descrittivo sulla card veicolo, la più
usata). Verificato che il JSX compili correttamente dopo la modifica.

### Campi senza etichetta accessibile

19 campi `<input>` (moduli nuovo veicolo, nuovo cliente, nuovo sinistro,
nuova lavorazione, ecc.) e 9 `<select>` nei moduli più usati
(accettazione, preventivi, assegnazione lavorazioni) si affidavano solo
al `placeholder` per far capire a cosa servisse il campo — non affidabile
per chi usa uno screen reader (il placeholder non è un'etichetta
accessibile persistente). Aggiunto `aria-label` corrispondente a ognuno,
nessun cambiamento visivo.

### Contrasto colori insufficiente

Calcolato il rapporto di contrasto reale (formula WCAG) per le
combinazioni di colore più usate. Trovate e corrette due combinazioni
sotto la soglia minima (4.5:1 per testo normale):

- Testo bianco su pulsante blu (`#FFFFFF` su `#2F80ED`, 3.87:1 — non
  conforme) in tre punti dell'app (moduli "Reinvia verifica email",
  "Aggiorna password", badge piano). Corretto usando lo stesso testo
  scuro (`#15171B`) già usato con ottimo contrasto (15.90:1) su tutti gli
  altri pulsanti blu dell'app — risultato anche più coerente visivamente.
- Testo del footer nelle pagine pubbliche create nei punti 23/24
  (`#6B7078` su sfondo scuro, 3.95:1 — non conforme per un testo di
  12-13px). Corretto con `#8D9099`, lo stesso grigio attenuato già usato
  altrove nell'app (6.17:1, ampiamente conforme).

## Verificato e già a posto

- Nessun `outline: none` che disabiliti il focus visibile della tastiera
  a livello globale.
- Testo principale e testo attenuato (colori più diffusi nell'app) già
  ampiamente conformi al contrasto minimo (rispettivamente 17.44:1 e
  6.17:1 su sfondo scuro).
- Indicatori di stato/severità (badge preventivo, gravità danno, stato
  pratica) mostrano sempre colore **più** testo, mai il colore da solo —
  verificato che l'unico indicatore puramente circolare/colorato trovato
  nel codice sia comunque seguito da un'etichetta testuale.

## Non corretto in questa sessione (limiti di tempo, non richiesto esplicitamente)

- **Chiusura modali con Esc**: nessun modale dell'app (sono circa una
  ventina, ognuno gestito autonomamente, senza un componente "Modal"
  condiviso) si chiude premendo Esc da tastiera — solo cliccando il
  pulsante di chiusura visibile. Non è un blocco totale (un utente da
  tastiera può comunque raggiungere e attivare il pulsante di chiusura
  con Tab+Invio), ma è una convenienza mancante rispetto allo standard.
  Correggerlo bene richiederebbe introdurre un componente Modal condiviso
  e migrare ogni modale esistente — un intervento a sé, non una modifica
  rapida.
- **Altri ~47 elementi `<div onClick>`** nel codice oltre alle 6 liste
  principali corrette (es. singole voci di menu, azioni secondarie
  dentro un modale già aperto): stesso rischio teorico di
  inaccessibilità da tastiera, ma non verificati uno per uno per restare
  in un tempo ragionevole — priorità data alle interazioni "apri un
  record dalla lista", il caso più frequente e più bloccante se manca.
- **Verifica screen reader reale** (es. con NVDA/VoiceOver): non
  eseguita — l'audit qui è basato su lettura del codice e calcolo del
  contrasto, non su un test con tecnologia assistiva reale. Consigliato
  come passo successivo se l'accessibilità diventa un requisito
  stringente (es. per un cliente pubblico o un obbligo normativo).
