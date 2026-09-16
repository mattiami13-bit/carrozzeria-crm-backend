CREATE TYPE "TicketCategoria" AS ENUM ('SUPPORTO', 'BUG', 'FUNZIONALITA');
CREATE TYPE "TicketPriorita" AS ENUM ('BASSA', 'MEDIA', 'ALTA', 'URGENTE');
CREATE TYPE "TicketStato" AS ENUM ('APERTO', 'IN_LAVORAZIONE', 'RISOLTO', 'CHIUSO');

CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoria" "TicketCategoria" NOT NULL,
    "priorita" "TicketPriorita" NOT NULL DEFAULT 'MEDIA',
    "messaggio" TEXT NOT NULL,
    "stato" "TicketStato" NOT NULL DEFAULT 'APERTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tickets_tenantId_stato_idx" ON "tickets"("tenantId", "stato");

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
