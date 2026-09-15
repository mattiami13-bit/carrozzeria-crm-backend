-- Allinea i valori del piano ai nomi commerciali ufficiali (STARTER/PRO/
-- PREMIUM_AI). Nessun tenant reale usa oggi PROFESSIONAL/ENTERPRISE
-- (verificato prima di scrivere questa migrazione), quindi è un rename
-- sicuro senza bisogno di backfill.
ALTER TYPE "Plan" RENAME VALUE 'PROFESSIONAL' TO 'PRO';
ALTER TYPE "Plan" RENAME VALUE 'ENTERPRISE' TO 'PREMIUM_AI';

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE', 'SUSPENDED');
CREATE TYPE "FatturazionePeriodicita" AS ENUM ('MENSILE', 'ANNUALE');

ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING';
ALTER TABLE "tenants" ADD COLUMN "fatturazionePeriodicita" "FatturazionePeriodicita" NOT NULL DEFAULT 'MENSILE';
ALTER TABLE "tenants" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "utentiExtra" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "creditiAIAcquistati" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "earlyAdopter" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants"("stripeCustomerId");
CREATE UNIQUE INDEX "tenants_stripeSubscriptionId_key" ON "tenants"("stripeSubscriptionId");

CREATE TABLE "stripe_webhook_events" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);
