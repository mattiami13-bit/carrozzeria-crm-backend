-- GDPR: consenso a Termini/Privacy con versione e timestamp, anonimizzazione
-- cliente su richiesta, coda di richieste GDPR (cancellazione/export).
ALTER TABLE "users" ADD COLUMN "condizioniAccettateVersione" TEXT;
ALTER TABLE "users" ADD COLUMN "condizioniAccettateAt" TIMESTAMP(3);

ALTER TABLE "clients" ADD COLUMN "datiAnonimizzati" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN "anonimizzatoAt" TIMESTAMP(3);

CREATE TYPE "GdprRichiestaTipo" AS ENUM ('CANCELLAZIONE_ACCOUNT', 'CANCELLAZIONE_CLIENTE', 'EXPORT_DATI');
CREATE TYPE "GdprRichiestaStato" AS ENUM ('IN_ATTESA', 'COMPLETATA', 'RIFIUTATA');

CREATE TABLE "gdpr_richieste" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" "GdprRichiestaTipo" NOT NULL,
    "stato" "GdprRichiestaStato" NOT NULL DEFAULT 'IN_ATTESA',
    "richiedenteId" TEXT NOT NULL,
    "clienteId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "risoltoAt" TIMESTAMP(3),

    CONSTRAINT "gdpr_richieste_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdpr_richieste_tenantId_stato_idx" ON "gdpr_richieste"("tenantId", "stato");

ALTER TABLE "gdpr_richieste" ADD CONSTRAINT "gdpr_richieste_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdpr_richieste" ADD CONSTRAINT "gdpr_richieste_richiedenteId_fkey" FOREIGN KEY ("richiedenteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdpr_richieste" ENABLE ROW LEVEL SECURITY;
