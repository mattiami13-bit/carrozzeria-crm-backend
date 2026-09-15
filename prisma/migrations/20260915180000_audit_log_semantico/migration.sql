-- Punto 21 (audit log): arricchisce audit_logs con un'etichetta
-- semantica, l'id della risorsa, l'IP e metadata essenziali, oltre al
-- log HTTP generico già presente. Tutte colonne nullable: nessun
-- impatto sulle righe già scritte.
ALTER TABLE "audit_logs" ADD COLUMN "azione" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "risorsaId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "ip" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "metadata" JSONB;

CREATE INDEX "audit_logs_tenantId_azione_createdAt_idx" ON "audit_logs"("tenantId", "azione", "createdAt");
