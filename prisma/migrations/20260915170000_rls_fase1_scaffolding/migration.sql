-- Fase 1 RLS (punto 19, sicurezza): abilita Row Level Security e crea
-- le policy di isolamento tenant su tutte le tabelle multi-tenant, come
-- seconda barriera oltre al filtro applicativo (tenantScope). Questa
-- migrazione è deliberatamente INERTE oggi: senza "FORCE ROW LEVEL
-- SECURITY", Postgres non applica le policy al proprietario delle
-- tabelle (il ruolo con cui l'app si connette oggi), quindi non cambia
-- alcun comportamento. Diventa realmente attiva solo in una fase
-- successiva, quando l'app si collegherà con un ruolo database
-- ristretto dedicato — vedi ARCHITECTURE.md / commit successivo.
--
-- Variabile di sessione usata dalle policy: app.tenant_id, impostata
-- dall'app con SET LOCAL prima di ogni query (fase successiva).
-- current_setting(..., true) restituisce NULL se non impostata, così le
-- policy semplicemente non concedono nulla finché l'app non la imposta
-- esplicitamente (fail-closed, mai fail-open).

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clients"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicles"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quotes"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "damage_analyses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "damage_analyses"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "damage_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "damage_items"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "insurance_gap_analyses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "insurance_gap_analyses"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "insurance_gap_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "insurance_gap_items"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "insurance_gap_suggestions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "insurance_gap_suggestions"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "parts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "parts"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "supplier_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_orders"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "loaner_cars" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loaner_cars"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "loaner_car_photos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loaner_car_photos"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "loaner_bookings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loaner_bookings"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "loaner_booking_photos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "loaner_booking_photos"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointments"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "sinistri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sinistri"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "portal_access" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_access"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "portal_actions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_actions"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_orders"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "work_order_time_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_order_time_entries"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "work_order_eventi" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_order_eventi"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "portal_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_documents"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ai_analysis_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_analysis_logs"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ai_assistant_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_assistant_logs"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "profit_records" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "profit_records"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "profit_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "profit_settings"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "delay_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "delay_settings"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "delay_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "delay_plans"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "delay_forecasts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "delay_forecasts"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "delay_decisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "delay_decisions"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "tracked_parts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tracked_parts"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "vehicle_part_blocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicle_part_blocks"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "tracked_part_documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tracked_part_documents"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_templates"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_messages"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "qc_checklist_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "qc_checklist_items"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "qc_inspections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "qc_inspections"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "qc_check_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "qc_check_results"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "qc_non_conformita" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "qc_non_conformita"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "qc_eventi" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "qc_eventi"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "briefing_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "briefing_settings"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "briefing_reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "briefing_reports"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "gdpr_richieste" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "gdpr_richieste"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "photos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "photos"
  USING (EXISTS (SELECT 1 FROM "vehicles" WHERE "vehicles"."id" = "photos"."vehicleId" AND "vehicles"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "vehicles" WHERE "vehicles"."id" = "photos"."vehicleId" AND "vehicles"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "stage_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stage_history"
  USING (EXISTS (SELECT 1 FROM "vehicles" WHERE "vehicles"."id" = "stage_history"."vehicleId" AND "vehicles"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "vehicles" WHERE "vehicles"."id" = "stage_history"."vehicleId" AND "vehicles"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "quote_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_items"
  USING (EXISTS (SELECT 1 FROM "quotes" WHERE "quotes"."id" = "quote_items"."quoteId" AND "quotes"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "quotes" WHERE "quotes"."id" = "quote_items"."quoteId" AND "quotes"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "part_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "part_movements"
  USING (EXISTS (SELECT 1 FROM "parts" WHERE "parts"."id" = "part_movements"."partId" AND "parts"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "parts" WHERE "parts"."id" = "part_movements"."partId" AND "parts"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "supplier_order_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_order_items"
  USING (EXISTS (SELECT 1 FROM "supplier_orders" WHERE "supplier_orders"."id" = "supplier_order_items"."supplierOrderId" AND "supplier_orders"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "supplier_orders" WHERE "supplier_orders"."id" = "supplier_order_items"."supplierOrderId" AND "supplier_orders"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents"
  USING (EXISTS (SELECT 1 FROM "clients" WHERE "clients"."id" = "documents"."clientId" AND "clients"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "clients" WHERE "clients"."id" = "documents"."clientId" AND "clients"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "time_entries"
  USING (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "time_entries"."userId" AND "users"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "time_entries"."userId" AND "users"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "tracked_part_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tracked_part_events"
  USING (EXISTS (SELECT 1 FROM "tracked_parts" WHERE "tracked_parts"."id" = "tracked_part_events"."partId" AND "tracked_parts"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "tracked_parts" WHERE "tracked_parts"."id" = "tracked_part_events"."partId" AND "tracked_parts"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "briefing_resolutions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "briefing_resolutions"
  USING (EXISTS (SELECT 1 FROM "briefing_reports" WHERE "briefing_reports"."id" = "briefing_resolutions"."reportId" AND "briefing_reports"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "briefing_reports" WHERE "briefing_reports"."id" = "briefing_resolutions"."reportId" AND "briefing_reports"."tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "photo_timeline_edits" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "photo_timeline_edits"
  USING (EXISTS (SELECT 1 FROM "photos" JOIN "vehicles" ON "vehicles"."id" = "photos"."vehicleId" WHERE "photos"."id" = "photo_timeline_edits"."photoId" AND "vehicles"."tenantId" = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "photos" JOIN "vehicles" ON "vehicles"."id" = "photos"."vehicleId" WHERE "photos"."id" = "photo_timeline_edits"."photoId" AND "vehicles"."tenantId" = current_setting('app.tenant_id', true)));

