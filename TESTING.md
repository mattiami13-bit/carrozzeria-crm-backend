# Test automatici

Stato al 16/09/2026 (punto 29 del prompt SaaS). Nessun mock del
database o delle API interne: ogni test crea dati veri, chiama l'app
HTTP vera (gli stessi router montati da `src/index.js`), e ripulisce a
fine test. Le uniche cose simulate sono la firma dei webhook Stripe
(con l'header helper ufficiale dell'SDK, non una firma inventata) e,
dove serve, price ID Stripe fittizi impostati esplicitamente dal test.

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
| Super-admin | ❌ non applicabile | nessun pannello super-admin esiste ancora (vedi sotto) |
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
- **Matrice billing completa** (tutti i piani × periodicità, Early
  Adopter, tetto 30 redemption, blocco downgrade sopra soglia utenti —
  quest'ultimo **non è nemmeno implementato**, un downgrade oggi
  riduce il piano senza controllare quanti utenti attivi ha il
  tenant): esplicitamente compito del punto 30 del prompt
  ("TEST BILLING OBBLIGATORI"), non duplicato qui.
