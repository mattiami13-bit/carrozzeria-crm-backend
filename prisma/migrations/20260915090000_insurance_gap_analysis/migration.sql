CREATE TYPE "InsuranceGapStatus" AS ENUM ('CORRISPONDE', 'DIFFERENZA', 'MANCANTE');

CREATE TABLE "insurance_gap_analyses" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
  "quoteId" TEXT NOT NULL REFERENCES "quotes"("id"),
  "sinistroId" TEXT REFERENCES "sinistri"("id"),
  "documentName" TEXT NOT NULL,
  "documentMime" TEXT NOT NULL,
  "documentSize" INTEGER NOT NULL CHECK ("documentSize" > 0 AND "documentSize" <= 5242880),
  "documentContent" BYTEA NOT NULL,
  "rispostaGrezza" JSONB,
  "totalePreventivoInterno" DECIMAL(10,2) NOT NULL,
  "totaleRiconosciutoAssicurazione" DECIMAL(10,2),
  "differenza" DECIMAL(10,2),
  "creatoDaId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "insurance_gap_analyses_tenantId_idx" ON "insurance_gap_analyses"("tenantId");
CREATE INDEX "insurance_gap_analyses_vehicleId_idx" ON "insurance_gap_analyses"("vehicleId");

CREATE TABLE "insurance_gap_items" (
  "id" TEXT PRIMARY KEY,
  "analysisId" TEXT NOT NULL REFERENCES "insurance_gap_analyses"("id"),
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "quoteItemId" TEXT NOT NULL REFERENCES "quote_items"("id"),
  "descrizione" TEXT NOT NULL,
  "tipo" "QuoteItemType" NOT NULL,
  "quantita" DECIMAL(10,2) NOT NULL,
  "prezzoUnitario" DECIMAL(10,2) NOT NULL,
  "trovatoAI" BOOLEAN NOT NULL DEFAULT false,
  "descrizioneAssicurazioneAI" TEXT,
  "quantitaAssicurazioneAI" DECIMAL(10,2),
  "prezzoUnitarioAssicurazioneAI" DECIMAL(10,2),
  "statoAI" "InsuranceGapStatus" NOT NULL,
  "quantitaAssicurazione" DECIMAL(10,2),
  "prezzoUnitarioAssicurazione" DECIMAL(10,2),
  "stato" "InsuranceGapStatus" NOT NULL,
  "noteOperatore" TEXT,
  "modificatoManualmente" BOOLEAN NOT NULL DEFAULT false,
  "modificatoDaId" TEXT REFERENCES "users"("id"),
  "modificatoAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "insurance_gap_items_tenantId_idx" ON "insurance_gap_items"("tenantId");
CREATE INDEX "insurance_gap_items_analysisId_idx" ON "insurance_gap_items"("analysisId");

CREATE TABLE "insurance_gap_suggestions" (
  "id" TEXT PRIMARY KEY,
  "analysisId" TEXT NOT NULL REFERENCES "insurance_gap_analyses"("id"),
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "voce" TEXT NOT NULL,
  "motivo" TEXT NOT NULL,
  "scartata" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "insurance_gap_suggestions_tenantId_idx" ON "insurance_gap_suggestions"("tenantId");
CREATE INDEX "insurance_gap_suggestions_analysisId_idx" ON "insurance_gap_suggestions"("analysisId");

ALTER TABLE "insurance_gap_analyses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurance_gap_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurance_gap_suggestions" ENABLE ROW LEVEL SECURITY;
