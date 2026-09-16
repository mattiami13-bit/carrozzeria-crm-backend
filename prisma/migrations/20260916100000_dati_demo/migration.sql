-- Punto 28 (dati demo): marca un tenant come "demo", separato dai tenant
-- reali. Default false, nessun impatto sui tenant esistenti.
ALTER TABLE "tenants" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
