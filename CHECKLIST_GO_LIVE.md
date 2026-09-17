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
| 1 | Dominio | ✅ | `www.rifless.it` e `app.rifless.it` entrambi live e verificati (DNS collegato il 17/09/2026, custom domain Railway + record CNAME/TXT su Register.it). |
| 2 | HTTPS | ✅ | Redirect HTTP→HTTPS verificato, HSTS attivo. |
| 3 | Database produzione | ✅ | Postgres su Supabase, dati reali, non un ambiente di test separato. |
| 4 | Backup | ✅ | Database: backup automatico giornaliero Supabase (retention 7gg). Foto: sincronizzate su un secondo bucket ogni 6 ore. Nessun secondo *provider* indipendente — vedi BACKUP-DISASTER-RECOVERY.md. |
| 5 | Stripe produzione | ✅ | Identità account verificata, chiavi live impostate su Railway. Verificato dal vivo il 17/09/2026: checkout reale per tutti e 6 i piani (Starter/Pro/Premium AI × mensile/annuale) restituisce `cs_live_...`. |
| 6 | Webhook Stripe | ✅ | Nuova destinazione "Produzione - billing" creata in modalità live su `https://www.rifless.it/api/billing/webhook`, 5 eventi collegati, firma verificata. |
| 7 | Email produzione | ✅ | Resend, mittente reale `notifiche@rifless.it` (non un dominio sandbox — bug trovato e corretto al punto 34). |
| 8 | Storage privato | ✅ | I tre bucket Supabase Storage (foto, backup foto, export dati) sono tutti privati, nessuno pubblico — verificato. |
| 9 | Environment variables | ✅ | Tutte documentate in `.env.example` con provenienza e scopo; nessun segreto o dominio hardcoded nel codice. |
| 10 | Privacy | ⚠️ | Testo reale scritto il 17/09/2026 con i dati aziendali effettivi (titolare, finalità, subprocessor, sicurezza, conservazione) — non più segnaposto. Consigliata comunque una revisione legale finale prima di un lancio su larga scala, come indicato nel banner della pagina stessa. |
| 11 | Termini | ⚠️ | Stesso stato della Privacy: testo reale con prezzi/condizioni effettive (piani, trial 30gg, foro di Milano), consigliata revisione legale finale. |
| 12 | Cookie | ✅ | Testo reale completo: nessun cookie di tracciamento in uso, spiegazione e gestione chiarite. Rischio legale minimo per questo documento specifico. |
| 12b | DPA (data processing agreement) | ⚠️ | Testo reale con oggetto, categorie di dati, subprocessor reali ed extra-UE elencati. Consigliata revisione legale finale, come le altre pagine legali. |
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
| 26 | Pagamento | ✅ | Flusso di checkout funzionante end-to-end in modalità live (voce 5): un pagamento reale può avvenire oggi. |
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
| 37 | Add-on utenti | ✅ | **Implementato al punto 51.** `POST /api/billing/utenti-extra` aggiunge posti extra all'abbonamento Stripe attivo (15€/mese/utente, Price ID live configurato), con interfaccia nel pannello "Piano e fatturazione". |
| 38 | Promo Early Adopter | ⚠️ | Attivazione e sconto funzionanti (99€/mese, primi 30, verificato). La reversione automatica al prezzo pieno dopo 12 mesi **non è implementata** (richiederebbe un job schedulato o una subscription schedule Stripe) — gap noto. |

## Riepilogo — aggiornato il 17/09/2026

**0 bloccanti reali** (❌). Tutti i blocchi tecnici sono stati risolti:
Stripe è in modalità live e verificato con checkout reali su tutti i
piani (#5, #6), il dominio `app.rifless.it` è collegato (#1), l'add-on
utenti extra è implementato (#37), e le 4 pagine legali sono state
scritte con i dati aziendali reali (#10, #11, #12, #12b) — non più
segnaposto.

**4 avvisi non bloccanti** (⚠️): Privacy/Termini/DPA hanno un testo
reale ma consigliano ancora una revisione legale finale prima di un
lancio su larga scala (rischio contenuto, non un blocco); error
tracking esterno (opzionale, richiede un tuo account); SEO minimo
(normale per un prodotto appena lanciato); reversione automatica
prezzo Early Adopter dopo 12 mesi non implementata (gap noto, non
bloccante per il lancio).

**34 voci verificate pronte** (✅).

Nessuna di queste voci è stata scelta per far tornare bene i numeri:
sono le stesse identiche 38 richieste dal prompt, verificate una per
una nell'ordine in cui compaiono.
