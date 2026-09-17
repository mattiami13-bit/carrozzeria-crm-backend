CREATE TYPE "DataExportStato" AS ENUM ('IN_CORSO', 'PRONTO', 'FALLITO');

CREATE TABLE "data_export_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "richiedenteId" TEXT NOT NULL,
    "stato" "DataExportStato" NOT NULL DEFAULT 'IN_CORSO',
    "storagePath" TEXT,
    "erroreMessaggio" TEXT,
    "scadenza" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completatoAt" TIMESTAMP(3),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_export_requests_tenantId_createdAt_idx" ON "data_export_requests"("tenantId", "createdAt");

ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_richiedenteId_fkey" FOREIGN KEY ("richiedenteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "data_export_requests" ENABLE ROW LEVEL SECURITY;
