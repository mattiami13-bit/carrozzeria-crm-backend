# Ambiente demo

Punto 28 del prompt SaaS: un ambiente/modalità demo separata, mai dati
finti dentro un tenant reale.

## Come funziona

- Il modello `Tenant` ha un campo `isDemo` (default `false`). Un tenant
  demo è marcato esplicitamente — non è "un tenant come gli altri con
  dati finti dentro", è un tipo di tenant riconoscibile nel database.
- `npm run seed:demo` crea (la prima volta) il tenant demo "Rifless
  Demo": un admin (`demo@rifless.it` / `RiflessDemo2026!`), 5 clienti e
  6 veicoli distribuiti su stadi diversi del workflow (accettazione,
  preventivo, ordine ricambi, lavorazione, verniciatura, pronta
  consegna), con un paio di preventivi di esempio. Comando idempotente:
  se il tenant demo esiste già, non fa nulla (a meno di `--reset`).
- `npm run seed:demo:reset` svuota i dati operativi del tenant demo
  (clienti, veicoli, preventivi, appuntamenti) e li ricrea da zero —
  utile per "resettare" la demo prima di ogni chiamata commerciale,
  senza accumulare dati sporchi da demo precedenti.
- Il tenant demo è **esente dal blocco abbonamento scaduto** (punto 23):
  una demo non deve mai interrompersi a metà per un trial "scaduto".

## La barriera di sicurezza ("mai su un tenant reale")

Lo script **non si fida del nome**: prima di scrivere o cancellare
qualunque dato, verifica nel database che il tenant target abbia
`isDemo=true`. Se esistesse già un tenant chiamato "Rifless Demo" ma
creato per errore come tenant reale (es. una registrazione vera con
quel nome), lo script si rifiuta di toccarlo e si ferma con un errore
esplicito — verificato con un test automatico dedicato
(`tests/demo-seed.test.js`) che simula esattamente questo scenario.

## Cosa NON è (per essere chiari)

- Non è un ambiente con un database separato: vive nello stesso database
  di produzione, isolato solo dal flag `isDemo` e dal normale isolamento
  multi-tenant già in uso per ogni cliente. Semplice e coerente con
  l'architettura esistente, ma significa che un bug nell'isolamento
  tenant (vedi punto 19, RLS) toccherebbe anche il tenant demo come
  qualunque altro.
- Non è collegato a nessuna pagina pubblica di "prova la demo": oggi va
  eseguito manualmente (`npm run seed:demo`) e le credenziali vanno
  condivise a mano con chi deve fare la demo. Costruire un flusso
  self-service ("richiedi una demo" dal sito pubblico) è fuori scope qui
  — il sito di marketing pubblico non esiste ancora.
