ALTER TABLE "photos" ADD COLUMN "visibilePortale" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "portal_access" ADD COLUMN "scadenza" TIMESTAMP(3);
ALTER TABLE "portal_access" ADD COLUMN "numeroAccessi" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "PortalActionTipo" AS ENUM (
  'APPROVAZIONE_PREVENTIVO', 'APPROVAZIONE_INTEGRAZIONE', 'FIRMA_DOCUMENTO',
  'RICHIESTA_CONTATTO', 'RICHIESTA_RITIRO'
);

CREATE TABLE "portal_actions" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
  "portalAccessId" TEXT NOT NULL REFERENCES "portal_access"("id"),
  "tipo" "PortalActionTipo" NOT NULL,
  "messaggio" TEXT,
  "dataRichiesta" TIMESTAMP(3),
  "ip" TEXT,
  "gestita" BOOLEAN NOT NULL DEFAULT false,
  "gestitaDaId" TEXT REFERENCES "users"("id"),
  "gestitaAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "portal_actions_tenantId_idx" ON "portal_actions"("tenantId");
CREATE INDEX "portal_actions_vehicleId_idx" ON "portal_actions"("vehicleId");

CREATE TABLE "portal_documents" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
  "nome" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "content" BYTEA NOT NULL,
  "richiedeFirma" BOOLEAN NOT NULL DEFAULT false,
  "firmaDataUrl" TEXT,
  "firmatarioNome" TEXT,
  "firmatoAt" TIMESTAMP(3),
  "caricatoDaId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "portal_documents_tenantId_idx" ON "portal_documents"("tenantId");
CREATE INDEX "portal_documents_vehicleId_idx" ON "portal_documents"("vehicleId");

ALTER TABLE "portal_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_documents" ENABLE ROW LEVEL SECURITY;
