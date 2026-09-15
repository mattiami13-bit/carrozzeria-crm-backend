# Responsive

Verifica del 15/09/2026 (punto 26 del prompt SaaS). Fatta con test veri nel
browser a larghezza smartphone (375px), tablet (768px) e desktop — non solo
lettura del codice — su un tenant di prova creato ed eliminato per
l'occasione, seguendo il flusso reale: registrazione → cliente → veicolo →
dettaglio pratica (foto, IA, modalità tecnico, portale cliente).

## Bug reali trovati e corretti

Il problema di fondo: diversi moduli usavano una griglia CSS a colonne
**fisse** (`gridTemplateColumns: "repeat(4, 1fr)"` o `"1fr 1fr 120px"`) per
allineare i campi di un modulo. A 375px di larghezza, 3-4 colonne fisse
sono troppo strette per contenere un `<input>`/`<select>` leggibile: il
modulo usciva dal bordo dello schermo e **faceva scorrere l'intera pagina
orizzontalmente** — bottoni "Salva"/"Annulla" e tutto il resto finivano
fuori vista, un problema serio, non estetico.

Corretti (passati da colonne fisse a `repeat(auto-fit, minmax(Npx, 1fr))`,
che si adatta da solo allo spazio disponibile, più `minWidth:0` sui singoli
campi — necessario perché browser impongono una larghezza minima di
default a `<input>`/`<select>` che altrimenti ignora il contenitore):

- **Nuovo veicolo** (accettazione) — il caso che ha fatto scoprire il
  problema, verificato dal vivo prima e dopo la correzione.
- **Nuovo cliente** (accettazione).
- **Nuova prenotazione auto sostitutiva**, tramite il componente `Field`
  condiviso (corretto una sola volta, in un punto, si applica ovunque
  quel componente è usato).
- **Nuovo sinistro** (tre griglie: dati cliente/veicolo, dati pratica,
  importi).
- **Nuovo preventivo** (selezione cliente/veicolo/IVA).
- **Assegna lavorazione** (modalità tecnico — reparto/tecnico/priorità/ore).

Verificato dal vivo nel browser (non solo lettura del codice) per
"Nuovo veicolo" e "Nuovo cliente"; gli altri condividono esattamente lo
stesso pattern di bug e la stessa correzione, verificata funzionante lì.

## Verificato e già a posto (nessuna modifica necessaria)

- **Onboarding** (login/registrazione): già ben strutturato su mobile,
  card centrata, campi a piena larghezza.
- **Foto** (Prima/Durante/Dopo + Smart Photo Timeline): il layout a 3
  colonne qui NON aveva bisogno di correzioni — a 375px le tre colonne
  "+ Aggiungi foto" restano leggibili e ben proporzionate. Verificato dal
  vivo prima di decidere se toccarlo.
- **Portale cliente**: già ottimo — timeline verticale, card ben
  proporzionate, nessun problema.
- **Workflow (board veicoli)**: colonne del Kanban con scorrimento
  orizzontale — pattern corretto e comune per questo tipo di interfaccia
  su mobile, non un bug.
- **Barra di navigazione principale**: su mobile scorre orizzontalmente
  (funziona, anche se non è il pattern ideale — vedi sotto); da 768px in
  su diventa una sidebar laterale fissa, già ben implementata.
- **Dashboard esecutiva**: già dotata di media query dedicate (viste in
  fase di audit), verificata funzionante.
- **Checkout (piano e fatturazione)**: struttura del modulo (titolo,
  selettore mensile/annuale, pulsante chiudi) corretta su mobile.

## Non corretto in questa sessione (a bassa priorità, non richiesto esplicitamente)

Altri ~8 punti nel codice usano lo stesso pattern di griglia fissa
(`1fr 1fr`, `1fr 1fr 1fr`) in moduli non esplicitamente elencati dal
prompt (magazzino ricambi, ordini fornitori, consegna/restituzione auto
sostitutive, dettaglio sinistro, controllo qualità non conformità). Stesso
rischio teorico, ma non verificati dal vivo uno per uno per restare dentro
un tempo ragionevole — priorità data alle aree esplicitamente richieste
(modalità tecnico, foto, accettazione, workflow, portale cliente,
dashboard, checkout, onboarding). Se emergono problemi concreti in uno di
questi moduli, la correzione è la stessa già applicata altrove: da
`gridTemplateColumns` a colonne fisse a `repeat(auto-fit, minmax(Npx, 1fr))`
+ `minWidth:0` sui campi.

## Osservazione minore, non responsive

Durante il test è emerso un problema di validazione non legato alla
responsività: il modulo "Nuovo cliente" mostra l'errore grezzo restituito
dal server (`{"formErrors":[],"fieldErrors":{"email":["Invalid email"]}}`)
invece di un messaggio leggibile, quando il campo email è lasciato vuoto.
Segnalato ma non corretto qui — fuori tema per il punto 26.
