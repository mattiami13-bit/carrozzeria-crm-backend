ALTER TABLE "tenants" ADD COLUMN "consentiLavorazioniSimultanee" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "Reparto" AS ENUM ('CARROZZERIA', 'MECCANICA', 'VERNICIATURA', 'FINITURA');
CREATE TYPE "PrioritaLavorazione" AS ENUM ('BASSA', 'NORMALE', 'ALTA', 'URGENTE');
CREATE TYPE "WorkOrderStato" AS ENUM ('DA_INIZIARE', 'IN_CORSO', 'IN_PAUSA', 'COMPLETATA');
CREATE TYPE "WorkOrderEventoTipo" AS ENUM ('CREATA', 'INIZIATA', 'PAUSA', 'RIPRESA', 'TERMINATA', 'CORREZIONE_MANUALE', 'RIASSEGNATA');

CREATE TABLE "work_orders" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
  "tecnicoId" TEXT NOT NULL REFERENCES "users"("id"),
  "titolo" TEXT NOT NULL,
  "reparto" "Reparto" NOT NULL,
  "priorita" "PrioritaLavorazione" NOT NULL DEFAULT 'NORMALE',
  "oreStimate" DECIMAL(6,2) NOT NULL,
  "noteTecniche" TEXT,
  "dataConsegna" TIMESTAMP(3),
  "stato" "WorkOrderStato" NOT NULL DEFAULT 'DA_INIZIARE',
  "creatoDaId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "work_orders_tenantId_idx" ON "work_orders"("tenantId");
CREATE INDEX "work_orders_tenantId_tecnicoId_idx" ON "work_orders"("tenantId", "tecnicoId");
CREATE INDEX "work_orders_vehicleId_idx" ON "work_orders"("vehicleId");

CREATE TABLE "work_order_time_entries" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "workOrderId" TEXT NOT NULL REFERENCES "work_orders"("id"),
  "tecnicoId" TEXT NOT NULL REFERENCES "users"("id"),
  "inizio" TIMESTAMP(3) NOT NULL,
  "fine" TIMESTAMP(3),
  "correzioneManuale" BOOLEAN NOT NULL DEFAULT false,
  "correzioneMotivo" TEXT,
  "correzioneDaId" TEXT REFERENCES "users"("id"),
  "correzioneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "work_order_time_entries_tenantId_idx" ON "work_order_time_entries"("tenantId");
CREATE INDEX "work_order_time_entries_workOrderId_idx" ON "work_order_time_entries"("workOrderId");
CREATE INDEX "work_order_time_entries_tecnicoId_idx" ON "work_order_time_entries"("tecnicoId");

CREATE TABLE "work_order_eventi" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "workOrderId" TEXT NOT NULL REFERENCES "work_orders"("id"),
  "tipo" "WorkOrderEventoTipo" NOT NULL,
  "daStato" "WorkOrderStato",
  "aStato" "WorkOrderStato",
  "dettagli" JSONB,
  "attoreId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "work_order_eventi_tenantId_idx" ON "work_order_eventi"("tenantId");
CREATE INDEX "work_order_eventi_workOrderId_idx" ON "work_order_eventi"("workOrderId");

ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_eventi" ENABLE ROW LEVEL SECURITY;
