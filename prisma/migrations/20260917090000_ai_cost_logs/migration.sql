CREATE TYPE "AiFunzione" AS ENUM ('ASSISTENTE', 'COPILOT', 'DAMAGE_ASSISTANT', 'INSURANCE_GAP', 'STIMA_DANNI_LEGACY', 'FOTO_CATEGORIA');

CREATE TABLE "ai_cost_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "funzione" "AiFunzione" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL,
    "tokenInput" INTEGER,
    "tokenOutput" INTEGER,
    "costoStimatoUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_cost_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_cost_logs_tenantId_createdAt_idx" ON "ai_cost_logs"("tenantId", "createdAt");
CREATE INDEX "ai_cost_logs_funzione_createdAt_idx" ON "ai_cost_logs"("funzione", "createdAt");

ALTER TABLE "ai_cost_logs" ADD CONSTRAINT "ai_cost_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_cost_logs" ENABLE ROW LEVEL SECURITY;
