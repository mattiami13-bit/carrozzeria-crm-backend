CREATE TABLE "tracked_parts" (
 "id" TEXT PRIMARY KEY, "requestKey" TEXT NOT NULL UNIQUE, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"), "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
 "orderItemId" TEXT UNIQUE REFERENCES "supplier_order_items"("id"), "catalogPartId" TEXT REFERENCES "parts"("id"),
 "status" TEXT NOT NULL DEFAULT 'DA_ORDINARE' CHECK ("status" IN ('DA_ORDINARE','ORDINATO','CONFERMATO','IN_TRANSITO','ARRIVATO','CONTROLLATO','MONTATO')),
 "data" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "tracked_parts_tenantId_vehicleId_idx" ON "tracked_parts"("tenantId","vehicleId");
CREATE TABLE "tracked_part_events" (
 "id" TEXT PRIMARY KEY, "partId" TEXT NOT NULL REFERENCES "tracked_parts"("id"), "actorId" TEXT,
 "fromStatus" TEXT, "toStatus" TEXT NOT NULL, "reason" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "tracked_part_events_partId_createdAt_idx" ON "tracked_part_events"("partId","createdAt");
CREATE TABLE "vehicle_part_blocks" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"), "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), CHECK ("endedAt" IS NULL OR "endedAt">="startedAt")
);
CREATE INDEX "vehicle_part_blocks_tenantId_vehicleId_idx" ON "vehicle_part_blocks"("tenantId","vehicleId");
CREATE UNIQUE INDEX "vehicle_one_open_part_block" ON "vehicle_part_blocks"("vehicleId") WHERE "endedAt" IS NULL;
CREATE TABLE "tracked_part_documents" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"), "partId" TEXT NOT NULL REFERENCES "tracked_parts"("id"),
 "name" TEXT NOT NULL, "mime" TEXT NOT NULL, "size" INTEGER NOT NULL CHECK ("size">0 AND "size"<=5242880), "content" BYTEA NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "tracked_part_documents_tenantId_partId_idx" ON "tracked_part_documents"("tenantId","partId");
ALTER TABLE "tracked_parts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracked_part_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_part_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracked_part_documents" ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION close_parts_block_on_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.stage = 'CONSEGNATA' THEN
  UPDATE "vehicle_part_blocks" SET "endedAt" = GREATEST("startedAt", COALESCE(NEW."dataConsegnaEffettiva",CURRENT_TIMESTAMP))
  WHERE "vehicleId"=NEW.id AND "tenantId"=NEW."tenantId" AND "endedAt" IS NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER parts_block_delivery AFTER UPDATE OF stage,"dataConsegnaEffettiva" ON vehicles
FOR EACH ROW EXECUTE FUNCTION close_parts_block_on_delivery();
