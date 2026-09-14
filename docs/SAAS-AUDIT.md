# Rifless — audit iniziale e piano incrementale

Richiesta sorgente: prompt SaaS definitivo del proprietario. Nome commerciale confermato: Rifless. Account Stripe dichiarato disponibile; nessuna chiave Stripe configurata rilevata. Dominio completo e dati del venditore non ancora forniti.

Inventario: `SAAS-AUDIT-INVENTORY.json`, 51 file applicativi e 148 route, con hash, codifica, variabili richieste e punti da esaminare. Le scansioni automatiche non costituiscono certificazione di sicurezza o collaudo delle 148 route.

## Architettura rilevata

- Frontend React 18, Babel nel browser, singolo HTML e portale separato. URL Railway incorporato nel frontend, preview Express locale. Da conservare i componenti, spostando la compilazione al build e rendendo configurabili gli URL.
- Backend Node 24, ESM, Express 4, Zod, Prisma 7 con adapter PostgreSQL; client generato TypeScript. Alcune route Express 4 non propagano correttamente errori asincroni.
- Database PostgreSQL su Supabase, migrazioni versionate. Tenant già esistenti, scoping manuale nelle route, ma FK singole consentono riferimenti a risorse di altra organizzazione. RLS non uniforme; connessione privilegiata da separare dall'identità runtime.
- Login bcrypt/JWT 8 ore; mancano revoca, verifica email, recupero password, gestione sessioni e limiti tentativi. L'ADMIN corrente non è distinto dal proprietario. Il dettaglio veicolo include l'intero tecnico, incluso passwordHash: da correggere.
- Storage Supabase service role sul server. Foto salvate tramite URL pubblici; timeline usa download server con validazione del percorso. AI legacy scarica URL dal database: da uniformare al downloader validato.
- Resend, Twilio WhatsApp, Anthropic; mittenti/template hardcoded e modelli AI da verificare. Chiave AI e Stripe non configurate rilevate. Le sole variabili di esempio non provano che un servizio sia operativo.
- Moduli: clienti, veicoli/workflow, preventivi/PDF/firme, foto/timeline/dossier, ricambi/magazzino/fornitori, sinistri, auto sostitutive, agenda, tecnici/timer, QC, portale, WhatsApp, Profit, Executive, Live, Copilot, Damage, Insurance Gap, Delay e Briefing.
- Incoerenza preesistente: schema auto sostitutive evoluto, route ancora su dataInizio/dataFine legacy. Va risolta prima di dichiarare preservate le funzioni.
- Nessun sito commerciale, billing, super-admin, onboarding, inviti, centro notifiche SaaS, export organizzazione o piano disaster recovery verificato.
- README obsoleto (SQLite e trial 30 giorni); `.gitignore` incompleto per varianti env. Liste senza paginazione; bundle monolitico. Esistono fixture test separate, nessuna cancellazione automatica di dati identificati come demo.

## Migrazione

1. Salvaguardare dati e moduli; inventario, test di riferimento e registro dei problemi.
2. Correggere accessi incrociati e serializzazione sensibile; controlli automatici Tenant A/B e sessioni revocabili.
3. Aggiungere schema SaaS solo tramite migrazioni additive, senza assegnare retroattivamente acquisti o trial fittizi ai tenant esistenti. Prevedere stato di migrazione esplicito.
4. Configurazione commerciale centralizzata, feature/quote e ruoli applicati nel backend; siti e percorsi autenticati separati.
5. Registrazione verificata, email asincrone, inviti, onboarding, impostazioni e billing Stripe con conferma webhook.
6. Super-admin separato, audit, usage, supporto, privacy/export, controlli operativi.
7. Staging isolato, test provider in modalità test, test A/B ed E2E; poi configurazioni live e verifica finale.

Non pubblicare né abilitare acquisti reali finché credenziali, dominio, testi legali, storage privato, backup e test critici non sono verificati. Non confondere una pagina UI o un test con provider simulato con un'integrazione live collaudata.
