CREATE TABLE "profit_records" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
 "vehicleId" TEXT NOT NULL UNIQUE REFERENCES "vehicles"("id"),
 "data" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "updatedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "profit_records_tenantId_idx" ON "profit_records"("tenantId");
CREATE TABLE "profit_settings" (
 "tenantId" TEXT PRIMARY KEY REFERENCES "tenants"("id"),
 "criticalBelow" INTEGER NOT NULL DEFAULT 20,
 "goodFrom" INTEGER NOT NULL DEFAULT 35,
 CONSTRAINT "profit_thresholds_valid" CHECK ("criticalBelow" >= 0 AND "goodFrom" > "criticalBelow" AND "goodFrom" <= 100)
);
-- Direct public Supabase access is denied; authenticated backend enforces tenant and role.
ALTER TABLE "profit_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profit_settings" ENABLE ROW LEVEL SECURITY;
