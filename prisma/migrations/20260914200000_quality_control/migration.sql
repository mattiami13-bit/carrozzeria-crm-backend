CREATE TABLE "qc_checklist_items" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "chiave" TEXT NOT NULL,
  "etichetta" TEXT NOT NULL,
  "ordine" INTEGER NOT NULL DEFAULT 0,
  "critico" BOOLEAN NOT NULL DEFAULT true,
  "attivo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qc_checklist_items_tenantId_chiave_key" UNIQUE ("tenantId", "chiave")
);
CREATE INDEX "qc_checklist_items_tenantId_idx" ON "qc_checklist_items"("tenantId");

CREATE TYPE "QcInspectionStato" AS ENUM ('IN_CORSO', 'APPROVATO');
CREATE TYPE "QcEsito" AS ENUM ('OK', 'DA_VERIFICARE', 'NON_CONFORME', 'NA');
CREATE TYPE "QcNonConformitaStato" AS ENUM ('APERTA', 'IN_LAVORAZIONE', 'RISOLTA', 'CHIUSA');
CREATE TYPE "QcEventoTipo" AS ENUM ('ISPEZIONE_AVVIATA', 'ESITO_AGGIORNATO', 'NON_CONFORMITA_APERTA', 'NON_CONFORMITA_AGGIORNATA', 'NON_CONFORMITA_CHIUSA', 'QC_APPROVATO');

CREATE TABLE "qc_inspections" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
  "stato" "QcInspectionStato" NOT NULL DEFAULT 'IN_CORSO',
  "iniziataDaId" TEXT REFERENCES "users"("id"),
  "approvatoDaId" TEXT REFERENCES "users"("id"),
  "approvatoAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "qc_inspections_tenantId_idx" ON "qc_inspections"("tenantId");
CREATE INDEX "qc_inspections_vehicleId_idx" ON "qc_inspections"("vehicleId");

CREATE TABLE "qc_check_results" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "inspectionId" TEXT NOT NULL REFERENCES "qc_inspections"("id"),
  "chiave" TEXT NOT NULL,
  "etichetta" TEXT NOT NULL,
  "critico" BOOLEAN NOT NULL,
  "esito" "QcEsito",
  "note" TEXT,
  "aggiornatoDaId" TEXT REFERENCES "users"("id"),
  "aggiornatoAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qc_check_results_inspectionId_chiave_key" UNIQUE ("inspectionId", "chiave")
);
CREATE INDEX "qc_check_results_tenantId_idx" ON "qc_check_results"("tenantId");
CREATE INDEX "qc_check_results_inspectionId_idx" ON "qc_check_results"("inspectionId");

CREATE TABLE "qc_non_conformita" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "inspectionId" TEXT NOT NULL REFERENCES "qc_inspections"("id"),
  "checkResultId" TEXT REFERENCES "qc_check_results"("id"),
  "descrizione" TEXT NOT NULL,
  "fotografia" BYTEA,
  "fotografiaMime" TEXT,
  "fotografiaSize" INTEGER,
  "responsabileId" TEXT REFERENCES "users"("id"),
  "azioneCorrettiva" TEXT,
  "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stato" "QcNonConformitaStato" NOT NULL DEFAULT 'APERTA',
  "creataDaId" TEXT REFERENCES "users"("id"),
  "chiusaAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "qc_non_conformita_tenantId_idx" ON "qc_non_conformita"("tenantId");
CREATE INDEX "qc_non_conformita_inspectionId_idx" ON "qc_non_conformita"("inspectionId");

CREATE TABLE "qc_eventi" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "inspectionId" TEXT NOT NULL REFERENCES "qc_inspections"("id"),
  "tipo" "QcEventoTipo" NOT NULL,
  "dettagli" JSONB,
  "attoreId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "qc_eventi_tenantId_idx" ON "qc_eventi"("tenantId");
CREATE INDEX "qc_eventi_inspectionId_idx" ON "qc_eventi"("inspectionId");

ALTER TABLE "qc_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qc_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qc_check_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qc_non_conformita" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qc_eventi" ENABLE ROW LEVEL SECURITY;
