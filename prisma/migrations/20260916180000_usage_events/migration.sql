CREATE TYPE "UsageEventTipo" AS ENUM ('EMAIL', 'API_ESTERNA');

CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "tipo" "UsageEventTipo" NOT NULL,
    "dettaglio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_events_tenantId_tipo_createdAt_idx" ON "usage_events"("tenantId", "tipo", "createdAt");

ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
