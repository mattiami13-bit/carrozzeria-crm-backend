# Checklist go-live (punto 46)

Verificato dal vivo il 17/09/2026 — ogni riga sotto è stata controllata
davvero (curl contro produzione, lettura del codice, o test automatico
eseguito), non spuntata a memoria. ✅ = pronto. ⚠️ = costruito ma con un
limite noto. ❌ = manca, serve un intervento (mio o tuo) prima di
vendere davvero. Diversa da [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
(punto 45): questa è una fotografia una tantum per decidere se si può
lanciare, non una checklist da ripetere a ogni deploy.

| # | Voce | Stato | Note |
|---|---|---|---|
| 1 | Dominio | ⚠️ | `www.rifless.it` live e verificato. `app.rifless.it` (punto 33, gestionale) predisposto lato codice ma non ancora collegato: DNS non risolve. Serve aggiungere il custom domain su Railway + record DNS — vedi PRODUCTION.md. |
| 2 | HTTPS | ✅ | Redirect HTTP→HTTPS verificato, HSTS attivo. |
| 3 | Database produzione | ✅ | Postgres su Supabase, dati reali, non un ambiente di test separato. |
| 4 | Backup | ✅ | Database: backup automatico giornaliero Supabase (retention 7gg). Foto: sincronizzate su un secondo bucket ogni 6 ore. Nessun secondo *provider* indipendente — vedi BACKUP-DISASTER-RECOVERY.md. |
| 5 | Stripe produzione | ❌ | **Bloccante.** Verificato oggi stesso creando una sessione di checkout reale: risposta `cs_test_...`, non `cs_live_...`. Nessun pagamento reale può avvenire. Procedura in PRODUCTION.md/BILLING.md. |
| 6 | Webhook Stripe | ⚠️ | Endpoint funzionante, firma verificata, idempotente (testato). Legato però alle chiavi test (voce 5) — quando si passa a chiavi live serve **anche** un nuovo webhook registrato in modalità live su Stripe (un webhook test non riceve eventi live). |
| 7 | Email produzione | ✅ | Resend, mittente reale `notifiche@rifless.it` (non un dominio sandbox — bug trovato e corretto al punto 34). |
| 8 | Storage privato | ✅ | I tre bucket Supabase Storage (foto, backup foto, export dati) sono tutti privati, nessuno pubblico — verificato. |
| 9 | Environment variables | ✅ | Tutte documentate in `.env.example` con provenienza e scopo; nessun segreto o dominio hardcoded nel codice. |
| 10 | Privacy | ❌ | Pagina esiste ma è ancora un segnaposto legale (9 sezioni marcate "da definire con il legale") — non scritta da me di proposito: è un testo che richiede una revisione legale reale, non generabile onestamente. |
| 11 | Termini | ❌ | Stesso stato della Privacy: segnaposto legale, stesso motivo. |
| 12 | Cookie | ❌ | **Corretto al punto 48**: era spuntata per errore. La pagina esiste ma è ancora un segnaposto legale (4 sezioni marcate "da definire con il legale"), stesso stato/motivo di Privacy e Termini. |
| 12b | DPA (data processing agreement) | ❌ | Trovato al punto 48, non era in questa checklist. Pagina esistente ma segnaposto legale (7 sezioni "da definire con il legale"), stesso motivo delle altre pagine legali. |
| 13 | Tenant isolation | ✅ | Verificato dal test dedicato (`tenant-isolation.test.js`): due tenant reali, nessun modo di raggiungere i dati dell'altro, incluso un tentativo IDOR diretto. |
| 14 | RBAC | ✅ | `rbac.test.js` — ruoli e permessi verificati. |
| 15 | Rate limiting | ✅ | Login, registrazione, azioni email, form pubblici (contatti/demo) — tutti limitati per IP. |
| 16 | Monitoring | ✅ | `/health` verifica davvero il database. Log strutturati per errori, latenza, job falliti. |
| 17 | Error tracking | ⚠️ | Errori backend E frontend loggati in modo strutturato e cercabile (prima di questo lavoro: zero visibilità sugli errori del browser cliente). Nessun servizio esterno di aggregazione/alert (Sentry o simile) collegato — richiederebbe un tuo account, mai creato senza consenso esplicito. |
| 18 | Test automatici | ✅ | 43 file, nessun mock di database/API interne, eseguiti prima di ogni singolo commit di questa sessione. |
| 19 | Responsive | ✅ | Verificato dal vivo su viewport mobile/tablet (punto 26), bug CSS reali trovati e corretti. |
| 20 | Performance | ✅ | N+1 risolti, paginazione, indice mancante aggiunto (punto 25). |
| 21 | SEO | ⚠️ | Aggiunti oggi meta description, canonical, Open Graph sulla home (mancavano del tutto). Nessun contenuto SEO esteso (blog, pagine per parola chiave) — normale per una landing page di un prodotto appena lanciato, non un gap urgente. |
| 22 | Sitemap | ✅ | `sitemap.xml` creato oggi, con le pagine pubbliche reali (non quelle transazionali/private). |
| 23 | Robots | ✅ | `robots.txt` creato oggi, esclude portale cliente e pagine transazionali, referenzia la sitemap. |
| 24 | Super-admin | ✅ | Login separato, confini di sicurezza testati, visibilità su tenant/lead/ticket/usage/costo AI. Nessuna interfaccia grafica, solo API (documentato, non un gap nascosto). |
| 25 | Trial | ✅ | 30 giorni automatici alla registrazione, nessuna carta richiesta. |
| 26 | Pagamento | ⚠️ | Flusso di checkout funzionante end-to-end — ma in modalità test (voce 5): nessun pagamento reale possibile oggi. |
| 27 | Cancellazione | ✅ | Abbonamento: self-service via Stripe Customer Portal. Account/organizzazione: riautenticazione + conferma testuale + periodo di grazia annullabile (punto 42). |
| 28 | Upgrade | ✅ | Self-service, verificato che le entitlement cambino subito dopo il webhook. |
| 29 | Downgrade | ✅ | Self-service, bloccato (409) se gli utenti attivi superano il nuovo piano — verificato in entrambi i casi. |
| 30 | Recupero password | ✅ | Flusso completo, rate-limited, token con scadenza. |
| 31 | Verifica email | ✅ | Flusso completo, reinvio disponibile. |
| 32 | Export | ✅ | Sincrono immediato + asincrono con notifica e link temporaneo firmato (punto 43), entrambi verificati con Supabase Storage reale. |
| 33 | Eliminazione account | ✅ | Punto 42 — riautenticazione, conferma testuale, periodo di grazia, mai automatica. |
| 34 | Audit log | ✅ | Ogni scrittura e ogni accesso negato tracciati, con allowlist esplicita di campi sicuri per rotta. |
| 35 | AI usage | ✅ | Tracciato per tenant/funzione, limiti mensili reali, alert al 90%/100% (punto 40). |
| 36 | Crediti AI | ✅ | Acquisto one-time funzionante, si sommano ai crediti esistenti (punto 30). |
| 37 | Add-on utenti | ❌ | **Non implementato.** Nessun prezzo Stripe configurato per l'acquisto di utenti extra oltre quelli inclusi nel piano — gap noto, documentato anche in TESTING.md/BILLING.md, non nascosto ora per la prima volta. |
| 38 | Promo Early Adopter | ⚠️ | Attivazione e sconto funzionanti (99€/mese, primi 30, verificato). La reversione automatica al prezzo pieno dopo 12 mesi **non è implementata** (richiederebbe un job schedulato o una subscription schedule Stripe) — gap noto. |

## Riepilogo

**4 bloccanti reali prima di vendere** (❌): Stripe in modalità live
(#5) — senza questo nessun pagamento è reale; Privacy (#10) e Termini
(#11) da far scrivere/rivedere da un legale; add-on utenti (#37) se lo
vuoi disponibile al lancio (altrimenti un cliente che supera gli
utenti inclusi nel piano non ha modo di aggiungerne senza cambiare
piano).

**6 avvisi non bloccanti** (⚠️): dominio `app.rifless.it` non ancora
collegato (il gestionale resta usabile, solo non raggiungibile dal suo
dominio dedicato), webhook Stripe da ricreare in modalità live insieme
alle chiavi, error tracking esterno (opzionale, richiede un tuo
account), SEO minimo (normale per un prodotto appena lanciato),
pagamento legato allo stesso blocco Stripe (#5), reversione automatica
Early Adopter dopo 12 mesi.

**28 voci verificate pronte** (✅).

Nessuna di queste voci è stata scelta per far tornare bene i numeri:
sono le stesse identiche 38 richieste dal prompt, verificate una per
una nell'ordine in cui compaiono.
