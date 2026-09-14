ALTER TABLE "clients" ADD COLUMN "notificheWhatsappConsenso" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN "notificheWhatsappConsensoAt" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN "notificheWhatsappAttive" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "WhatsappEvento" AS ENUM (
  'ACCETTAZIONE', 'PREVENTIVO', 'ATTESA_APPROVAZIONE', 'ORDINE_RICAMBI',
  'IN_LAVORAZIONE', 'PREPARAZIONE', 'VERNICIATURA', 'LUCIDATURA',
  'CONTROLLO_QUALITA', 'LAVAGGIO', 'PRONTA_CONSEGNA', 'CONSEGNATA',
  'RICAMBIO_RITARDO'
);

CREATE TYPE "WhatsappMessageStato" AS ENUM ('INVIATO', 'CONSEGNATO', 'LETTO', 'FALLITO', 'RISPOSTA_RICEVUTA');

CREATE TABLE "whatsapp_templates" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "evento" "WhatsappEvento" NOT NULL,
  "attivo" BOOLEAN NOT NULL DEFAULT false,
  "testo" TEXT NOT NULL,
  "aggiornatoDaId" TEXT REFERENCES "users"("id"),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_templates_tenantId_evento_key" UNIQUE ("tenantId", "evento")
);
CREATE INDEX "whatsapp_templates_tenantId_idx" ON "whatsapp_templates"("tenantId");

CREATE TABLE "whatsapp_messages" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "vehicleId" TEXT NOT NULL REFERENCES "vehicles"("id"),
  "clientId" TEXT NOT NULL REFERENCES "clients"("id"),
  "evento" "WhatsappEvento" NOT NULL,
  "testo" TEXT NOT NULL,
  "telefono" TEXT NOT NULL,
  "stato" "WhatsappMessageStato" NOT NULL DEFAULT 'INVIATO',
  "providerMessageSid" TEXT,
  "errore" TEXT,
  "rispostaTesto" TEXT,
  "rispostaAt" TIMESTAMP(3),
  "inviatoDaId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "whatsapp_messages_tenantId_idx" ON "whatsapp_messages"("tenantId");
CREATE INDEX "whatsapp_messages_vehicleId_idx" ON "whatsapp_messages"("vehicleId");
CREATE INDEX "whatsapp_messages_providerMessageSid_idx" ON "whatsapp_messages"("providerMessageSid");

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
