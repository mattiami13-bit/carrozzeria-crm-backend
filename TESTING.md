# Test automatici

Scritto originariamente al punto 29 del prompt SaaS, aggiornato al
17/09/2026 (punto 45, "documentazione tecnica" — la tabella sotto era
rimasta ferma al punto 29 mentre il codice continuava ad avanzare:
esattamente il tipo di scarto che questo stesso punto chiede di
correggere). 43 file di test ad oggi. Nessun mock del database o delle
API interne: ogni test crea dati veri, chiama l'app HTTP vera (gli
stessi router montati da `src/index.js`), e ripulisce a fine test. Le
uniche cose simulate sono la firma dei webhook Stripe (con l'header
helper ufficiale dell'SDK, non una firma inventata) e, dove serve,
price ID Stripe fittizi impostati esplicitamente dal test.

`npm run test:<area>` per ogni file — vedi `package.json` per l'elenco.

## Copertura rispetto alla checklist del prompt

| Richiesto | Copertura | File |
|---|---|---|
| Registrazione | ✅ | `auth-email.test.js` |
| Login | ✅ | `auth-email.test.js`, `security.test.js` (rate limiting) |
| Reset password | ✅ | `auth-email.test.js` |
| **Tenant isolation** | ✅ (test fondamentale, vedi sotto) | `tenant-isolation.test.js` |
| RBAC | ✅ (nuovo) | `rbac.test.js` |
| Creazione carrozzeria | ✅ | `auth-email.test.js` (la registrazione crea il tenant) |
| Invito utente | ✅ (nuovo) | `rbac.test.js` |
| Checkout | ✅ | `billing.test.js` |
| Webhook | ✅ | `billing.test.js` |
| Upgrade | ✅ (nuovo, base) | `billing-plan-changes.test.js` |
| Downgrade | ✅ (nuovo, base) | `billing-plan-changes.test.js` |
| Cancellazione | ✅ | `billing.test.js` (`customer.subscription.deleted`) |
| Feature entitlement | ✅ (nuovo) | `feature-entitlement.test.js` |
| Super-admin | ✅ (punto 31) | `super-admin.test.js` — login, i due confini di sicurezza (token tenant/super-admin mai intercambiabili), leads, FAQ, changelog, feature flag, usage, costo AI (vedi [SUPER-ADMIN.md](SUPER-ADMIN.md)) |
| Upload protetto | ✅ (nuovo) | `photos-upload.test.js` |

## Il test fondamentale (tenant isolation)

`tenant-isolation.test.js` crea due tenant reali (A e B) con dati veri
— cliente, veicolo, preventivo, ispezione QC, lavorazione, auto
sostitutiva, analisi assicurazione con **documento binario allegato**
— e verifica che il Tenant B non possa in nessun modo raggiungere le
risorse di A: lettura, modifica, cambio stato, liste (l'id di A non
deve comparire), **download di file binari**, e un tentativo diretto di
manipolazione IDOR (creare un veicolo agganciato a un cliente di A).
Verificato anche che nessuna di queste rotte risponda senza un token
valido. Il Copilot AI è verificato per ispezione statica del codice
(richiede una chiave Anthropic non disponibile in locale): ogni
`where` delle sue query deve contenere `tenantId`, senza eccezioni.

## Cosa ho trovato scrivendo questi test (non solo aggiunto copertura)

Scrivere i test mancanti ha fatto emergere problemi reali, non solo
"buchi di copertura" — coerente con l'idea che un test vero, contro il
comportamento reale, trova bug che un audit di codice da solo non vede:

- **Feature entitlement non applicato da nessuna parte**: `PIANI` in
  `lib/billing/piani.js` descriveva quali funzioni include ogni piano
  (Copilot AI, Modalità Tecnico, Controllo Qualità, ecc.), ma nessuna
  rotta lo controllava — un tenant Starter poteva usare funzioni
  Premium AI gratuitamente. Aggiunto `middleware/feature.js`
  (`requireFeature`), applicato a 17 router nelle rotte Pro/Premium AI.
- **Bug che bloccava i clienti paganti Pro/Premium AI**: 8 punti nel
  codice (limiti mensili di analisi IA) usavano ancora i vecchi nomi
  dei piani `PROFESSIONAL`/`ENTERPRISE`, rinominati giorni fa in
  `PRO`/`PREMIUM_AI`. Risultato pratico: un cliente Pro o Premium AI
  aveva il limite mensile di analisi IA a **zero**, di fatto bloccato
  dalle funzioni che paga in più. Corretto in tutti i file.
- **Upload foto: errore 500 invece di 400** per un file non immagine —
  l'errore del filtro Multer non veniva riconosciuto dal gestore
  errori dedicato (controllava solo `MulterError`, non l'errore
  generico del filtro tipo file). Corretto.

## Non ancora fatto (limiti di tempo, o compito di un punto successivo)

- **Super-admin**: non testabile perché non esiste ancora un pannello
  super-admin (elencato tra le funzionalità non ancora costruite).

## Punto 30 — Test billing obbligatori

Vedi `tests/billing-checklist.test.js` (17 casi) + `billing.test.js` +
`billing-plan-changes.test.js`: copre l'intera checklist del prompt —
prezzi per tutti e 6 i piani/periodicità, trial Pro, Early Adopter
(prezzo, tetto 30 redemption, setup fee gratuita), setup fee normale,
upgrade/downgrade, blocco downgrade sopra soglia utenti, crediti AI,
pagamento riuscito/fallito, rinnovo, cancellazione a fine periodo,
riattivazione, webhook duplicato, entitlement aggiornati subito dopo
il cambio piano, quota IA mensile (verifica statica, stesso limite già
noto per il Copilot: richiede ANTHROPIC_API_KEY non disponibile in
locale), retention dati dopo cancellazione.

Scrivere questi test ha fatto emergere ancora gap reali, non solo
buchi di copertura:

- **Blocco downgrade sopra soglia utenti**: non esisteva per niente —
  un downgrade a un piano con meno utenti inclusi veniva accettato
  senza controlli. Implementato in `POST /api/billing/checkout`
  (confronta gli utenti attivi con quelli inclusi nel piano di
  destinazione, 409 se sopra soglia).
- **Crediti AI: nessun modo per comprarli** — il prezzo Stripe era già
  configurato (`STRIPE_PRICE_AI_CREDITI_PACK`) ma nessuna rotta lo
  usava. Aggiunto `POST /api/billing/crediti-ai` (acquisto una tantum,
  mode "payment") + gestione del webhook corrispondente (accredita
  `creditiAIAcquistati`, mai tocca piano/stato abbonamento).
- **Setup fee non gratuita per Early Adopter**: il costo di attivazione
  di 199€ veniva addebitato anche a chi aderiva alla promo Early
  Adopter (che dovrebbe includerlo gratis). Corretto: la setup fee non
  si aggiunge più quando `earlyAdopter: true`.

### Genuinamente non implementato (non testato perché non esiste)

- **"Utente extra"**: `Tenant.utentiExtra` e `UTENTE_EXTRA_MENSILE_CENTS`
  esistono solo come configurazione/visualizzazione — non c'è nessuna
  rotta per comprare davvero un posto utente aggiuntivo. A differenza
  dei crediti AI (acquisto una tantum, semplice), un utente extra è
  concettualmente un addebito ricorrente aggiunto all'abbonamento
  esistente (un "subscription item" separato in Stripe), un meccanismo
  diverso e più delicato da implementare bene — e richiede prima un
  nuovo Price Stripe dedicato, che non esiste ancora
  (`.env.example` non ha una variabile per questo). Non costruito né
  testato in questa sessione: da trattare come intervento a sé.
- **Scadenza automatica della promo Early Adopter dopo 12 mesi**
  (`EARLY_ADOPTER.mesiDurata`): il prezzo scontato resta fisso finché
  qualcuno non lo cambia manualmente — non esiste nessun meccanismo
  (job pianificato o subscription schedule Stripe) che lo riporti al
  prezzo pieno dopo 12 mesi. Il campo `mesiDurata` è oggi solo
  documentazione, non applicato.
