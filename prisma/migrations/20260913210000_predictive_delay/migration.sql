CREATE TABLE "delay_settings" (
 "tenantId" TEXT PRIMARY KEY REFERENCES "tenants"("id"), "data" JSONB NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "delay_plans" (
 "vehicleId" TEXT PRIMARY KEY REFERENCES "vehicles"("id"), "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
 "data" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "updatedById" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "delay_plans_tenantId_idx" ON "delay_plans"("tenantId");
CREATE TABLE "delay_forecasts" (
 "id" TEXT PRIMARY KEY, "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"), "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
 "fingerprint" TEXT NOT NULL, "modelVersion" TEXT NOT NULL, "promisedAt" TIMESTAMP(3), "estimatedDate" TEXT,
 "risk" INTEGER CHECK ("risk" BETWEEN 0 AND 100), "input" JSONB NOT NULL, "result" JSONB NOT NULL,
 "actualDeliveredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "delay_forecasts_vehicleId_fingerprint_key" ON "delay_forecasts"("vehicleId", "fingerprint");
CREATE INDEX "delay_forecasts_tenantId_createdAt_idx" ON "delay_forecasts"("tenantId", "createdAt");
CREATE INDEX "delay_forecasts_vehicleId_createdAt_idx" ON "delay_forecasts"("vehicleId", "createdAt");
CREATE TABLE "delay_decisions" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"), "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
 "forecastId" TEXT NOT NULL REFERENCES "delay_forecasts"("id"), "action" TEXT NOT NULL CHECK ("action" IN ('KEEP', 'REVISE', 'DRAFT')),
 "proposedDate" TEXT, "note" TEXT NOT NULL, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "delay_decisions_tenantId_vehicleId_createdAt_idx" ON "delay_decisions"("tenantId", "vehicleId", "createdAt");
ALTER TABLE "delay_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delay_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delay_forecasts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delay_decisions" ENABLE ROW LEVEL SECURITY;
-- Record actual outcomes regardless of which existing delivery workflow writes the date.
-- This never changes the promised date or the original forecast.
CREATE FUNCTION record_delay_actual_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."dataConsegnaEffettiva" IS DISTINCT FROM OLD."dataConsegnaEffettiva" THEN
  UPDATE "delay_forecasts" SET "actualDeliveredAt" = NEW."dataConsegnaEffettiva"
  WHERE "vehicleId" = NEW.id AND "tenantId" = NEW."tenantId";
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vehicle_delay_actual_delivery AFTER UPDATE OF "dataConsegnaEffettiva" ON "vehicles"
FOR EACH ROW EXECUTE FUNCTION record_delay_actual_delivery();

-- Serialize forecast creation with delivery updates to avoid losing an outcome during a race.
CREATE FUNCTION capture_delay_delivery_on_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT "dataConsegnaEffettiva" INTO NEW."actualDeliveredAt" FROM "vehicles"
 WHERE id = NEW."vehicleId" AND "tenantId" = NEW."tenantId" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid forecast vehicle/tenant'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER delay_forecast_capture_delivery BEFORE INSERT ON "delay_forecasts"
FOR EACH ROW EXECUTE FUNCTION capture_delay_delivery_on_insert();
