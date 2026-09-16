CREATE TYPE "LeadOrigine" AS ENUM ('CONTATTO', 'DEMO');
CREATE TYPE "LeadStato" AS ENUM ('NUOVO', 'CONTATTATO', 'DEMO', 'TRIAL', 'CLIENTE', 'PERSO');

CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cognome" TEXT,
    "carrozzeria" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "numeroDipendenti" INTEGER,
    "messaggio" TEXT,
    "origine" "LeadOrigine" NOT NULL,
    "stato" "LeadStato" NOT NULL DEFAULT 'NUOVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- Imparato dall'incidente su stripe_webhook_events (allerta Supabase
-- Security Advisor): RLS abilitata subito alla creazione della tabella,
-- non aggiunta dopo.
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
