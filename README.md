# Carrozzeria CRM — Backend

API REST multi-tenant per il CRM carrozzerie. Node.js + Express + Prisma.

## Avvio rapido (sviluppo locale con SQLite)

1. In `prisma/schema.prisma` cambia il datasource:
   ```prisma
   datasource db {
     provider = "sqlite"
     url      = "file:./dev.db"
   }
   ```
   (in produzione si usa Postgres, come già impostato di default)

2. Installa le dipendenze:
   ```bash
   npm install
   ```

3. Copia `.env.example` in `.env` e imposta `JWT_SECRET`.

4. Crea il database e le tabelle:
   ```bash
   npm run prisma:migrate
   ```

5. Avvia il server:
   ```bash
   npm run dev
   ```

L'API risponde su `http://localhost:4000`.

## Flusso tipico

1. `POST /api/auth/register` — crea la carrozzeria (tenant) + utente admin, avvia trial 30gg
2. `POST /api/auth/login` — ottieni il JWT
3. Tutte le altre route richiedono header `Authorization: Bearer <token>`
4. `POST /api/clients` — crea un cliente
5. `POST /api/vehicles` — crea un veicolo collegato al cliente (entra in stato `ACCETTAZIONE`)
6. `PATCH /api/vehicles/:id/stage` — fa avanzare il veicolo nel workflow (scrive anche la cronologia)
7. `POST /api/quotes` — crea un preventivo con voci di manodopera/ricambi/vernice
8. `GET /api/dashboard/summary` — KPI per la dashboard

## Isolamento multi-tenant

Ogni tabella ha `tenantId`. Il middleware `requireAuth` legge il tenant
**dal JWT firmato dal server**, mai da input del client, ed ogni query
Prisma nelle route lo include tramite l'helper `tenantScope(req)`.
Questo impedisce che un utente della carrozzeria A possa leggere o
modificare dati della carrozzeria B, anche per errore di programmazione
su una singola route — è comunque consigliato aggiungere Row Level
Security a livello Postgres come seconda barriera prima del rilascio
in produzione.

## Cosa manca ancora (prossimi moduli)

- Upload foto su object storage (S3/R2) + route `POST /api/vehicles/:id/photos`
- Generazione PDF preventivo
- Invio WhatsApp/email automatico sui cambi di stato (agganciato al TODO in `vehicles.js`)
- Firma digitale su tablet
- Portale cliente (sola lettura, scoping per clientId oltre che tenantId)
- Magazzino ricambi: route di carico/scarico e avviso scorta minima
- Calendario: route CRUD su `Appointment`
- Timbratura dipendenti: route CRUD su `TimeEntry`
