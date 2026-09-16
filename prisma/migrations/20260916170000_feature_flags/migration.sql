CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "chiave" TEXT NOT NULL,
    "descrizione" TEXT,
    "abilitataGlobalmente" BOOLEAN NOT NULL DEFAULT true,
    "piani" "Plan"[],
    "ambienti" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_flags_chiave_key" ON "feature_flags"("chiave");

CREATE TABLE "feature_flag_tenant_overrides" (
    "id" TEXT NOT NULL,
    "featureFlagId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "abilitata" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_tenant_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_flag_tenant_overrides_featureFlagId_tenantId_key" ON "feature_flag_tenant_overrides"("featureFlagId", "tenantId");

ALTER TABLE "feature_flag_tenant_overrides" ADD CONSTRAINT "feature_flag_tenant_overrides_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_flag_tenant_overrides" ADD CONSTRAINT "feature_flag_tenant_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flag_tenant_overrides" ENABLE ROW LEVEL SECURITY;
