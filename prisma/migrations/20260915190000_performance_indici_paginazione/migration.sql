-- Punto 25 (performance): indice composito mancante per il pattern di
-- query più usato su Appointment (tenantId + range su "inizio", per la
-- vista calendario e il controllo disponibilità tecnici).
CREATE INDEX "appointments_tenantId_inizio_idx" ON "appointments"("tenantId", "inizio");
