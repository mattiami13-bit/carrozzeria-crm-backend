CREATE TABLE "briefing_settings" (
 "tenantId" TEXT PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
 "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "briefing_reports" (
 "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "day" TEXT NOT NULL, "kind" TEXT NOT NULL, "data" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "briefing_reports_tenantId_day_kind_key" UNIQUE ("tenantId","day","kind")
);
CREATE TABLE "briefing_resolutions" (
 "id" TEXT PRIMARY KEY, "reportId" TEXT NOT NULL REFERENCES "briefing_reports"("id") ON DELETE CASCADE,
 "actionKey" TEXT NOT NULL, "userId" TEXT NOT NULL, "note" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "briefing_resolutions_reportId_actionKey_key" UNIQUE ("reportId","actionKey")
);

ALTER TABLE "briefing_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefing_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefing_resolutions" ENABLE ROW LEVEL SECURITY;
