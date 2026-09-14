-- Catalog and order deletion must retain practice history and recorded costs.
ALTER TABLE tracked_parts DROP CONSTRAINT "tracked_parts_catalogPartId_fkey";
ALTER TABLE tracked_parts ADD CONSTRAINT "tracked_parts_catalogPartId_fkey" FOREIGN KEY ("catalogPartId") REFERENCES parts(id) ON DELETE SET NULL;
ALTER TABLE tracked_parts DROP CONSTRAINT "tracked_parts_orderItemId_fkey";
ALTER TABLE tracked_parts ADD CONSTRAINT "tracked_parts_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES supplier_order_items(id) ON DELETE SET NULL;
