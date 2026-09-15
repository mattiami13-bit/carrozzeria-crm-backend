# Monitoring

Stato reale al 15/09/2026. Come per `BACKUP-DISASTER-RECOVERY.md`, ogni
voce qui sotto è verificata, non presunta.

## Cosa c'è oggi (nel codice, funzionante)

| Area richiesta dal prompt | Copertura |
|---|---|
| Health endpoint | `GET /health` verifica davvero la connessione al database (query reale, non solo "ok" fisso), segnala se le dipendenze esterne (Storage, email, WhatsApp, pagamenti, AI) sono configurate, e se il sito è in manutenzione. Risponde 503 se il database non è raggiungibile. |
| Errori backend | Log strutturato (JSON) su ogni errore server non gestito: timestamp, metodo, percorso, tenant/utente coinvolti, messaggio, stack — vedi punto 23. Mai inviato al client, solo nei log del server. |
| Errori frontend | `POST /api/client-errors`: il gestionale (file HTML) intercetta ogni errore JavaScript non gestito (`window.onerror`) e ogni Promise rifiutata senza `.catch` (`unhandledrejection`) e li invia qui. Prima di questo lavoro: **zero visibilità**, un errore nel browser del cliente era invisibile a chiunque. |
| API latency | Ogni richiesta più lenta di 2 secondi produce una riga di log strutturata (`tipo: "richiesta_lenta"`) con la durata esatta — le richieste veloci non vengono loggate (rumore inutile). |
| Job falliti (worker in background) | Predictive Delay, Morning Briefing, Backup foto: ognuno logga già l'errore con `console.error` e un prefisso riconoscibile (`[photo-backup]`, ecc.) se un'esecuzione fallisce — cercabile nei log Railway. |
| Webhook falliti | Stripe (`[billing]`) e Twilio WhatsApp: firma non valida, errore di elaborazione o evento sconosciuto sono già loggati con un prefisso riconoscibile. |
| Email fallite | `src/lib/email.js` logga ogni tentativo (riuscito o fallito) con destinatario, oggetto e id/errore; ritenta automaticamente prima di arrendersi. |
| Storage | `/health` segnala se le credenziali Storage sono configurate; il worker di backup foto (punto 22) logga ogni copia fallita. |
| Uptime | **Non coperto da un servizio esterno** — vedi sotto. |

## Cosa NON c'è (richiede un servizio esterno, con relativo account)

Questi tre punti non possono essere "attivati da codice": richiedono un
provider esterno con un proprio account, spesso a pagamento oltre una
soglia gratuita. Non li ho configurati senza il tuo consenso esplicito,
coerentemente con come abbiamo gestito Cloudflare R2 per il backup.

1. **Uptime monitoring reale** (qualcuno/qualcosa che controlli `/health`
   ogni pochi minuti e ti avvisi — email/SMS/WhatsApp — se il sito
   risulta giù). Opzioni comuni con un piano gratuito sufficiente per
   iniziare: UptimeRobot, Better Uptime, Pingdom. Richiede solo puntare
   il servizio a `https://www.rifless.it/health` — pochi minuti, ma va
   fatto da te (creazione account).
2. **Aggregazione/alerting errori** (un pannello che raggruppa gli errori
   ripetuti, avvisa quando ne compare uno nuovo, mostra trend nel tempo)
   — oggi gli errori sono loggati in modo strutturato e cercabili, ma
   restano dentro ai log grezzi di Railway, senza un pannello dedicato.
   Un servizio come Sentry (piano gratuito disponibile) potrebbe leggere
   sia gli errori backend sia quelli frontend già raccolti da questo
   lavoro, con il minimo sforzo di integrazione visto che i dati
   strutturati esistono già.
3. **Dashboard "unica"** per API latency/errori/uptime insieme: oggi sono
   tre fonti separate (log Railway, `/health`, `/api/client-errors`),
   non un'unica vista. Railway offre già una scheda "Metrics" (CPU,
   memoria, rete) e "Logs" (ricerca full-text) senza bisogno di nulla di
   nuovo — sufficiente per iniziare, ma non sostituisce un vero APM.

## Dove guardare oggi, in pratica

- **Log strutturati**: Railway → servizio `carrozzeria-crm-backend` →
  scheda "Deployments" → log del deploy attivo, oppure "Logs" a livello
  di progetto per la ricerca. Cerca `"tipo":"errore_frontend"`,
  `"tipo":"richiesta_lenta"`, `"livello":"error"`, o i prefissi
  `[billing]`/`[email]`/`[photo-backup]` per filtrare per area.
- **Stato in tempo reale**: `curl https://www.rifless.it/health` — utile
  anche per un controllo manuale rapido prima di intervenire su
  qualcosa, per assicurarsi che il database sia raggiungibile.
- **Metriche infrastruttura** (CPU/memoria/rete): Railway → scheda
  "Metrics" del servizio — già disponibile, nessuna configurazione
  necessaria.
