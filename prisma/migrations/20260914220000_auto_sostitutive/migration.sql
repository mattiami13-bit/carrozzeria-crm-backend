-- Attenzione: loaner_cars/loaner_bookings hanno già dati reali in
-- produzione (una flotta con auto assegnate). Questa migrazione aggiunge
-- colonne e ne ricava i valori dai dati esistenti, senza mai cancellarli:
-- le vecchie colonne "dataInizio"/"dataFine" restano nella tabella
-- (semplicemente non più mappate da Prisma) invece di essere rimosse.

CREATE TYPE "LoanerFuelType" AS ENUM ('BENZINA', 'DIESEL', 'GPL', 'METANO', 'ELETTRICA', 'IBRIDA');
CREATE TYPE "LoanerFuelLevel" AS ENUM ('VUOTO', 'UN_QUARTO', 'META', 'TRE_QUARTI', 'PIENO');
CREATE TYPE "LoanerCarStatoManuale" AS ENUM ('MANUTENZIONE', 'NON_DISPONIBILE');
CREATE TYPE "LoanerBookingStato" AS ENUM ('PRENOTATA', 'ASSEGNATA', 'RESTITUITA', 'ANNULLATA');
CREATE TYPE "LoanerPhotoFase" AS ENUM ('CONSEGNA', 'RESTITUZIONE');

ALTER TABLE "loaner_cars" ADD COLUMN "km" INTEGER;
ALTER TABLE "loaner_cars" ADD COLUMN "carburante" "LoanerFuelType" NOT NULL DEFAULT 'BENZINA';
ALTER TABLE "loaner_cars" ADD COLUMN "assicurazioneScadenza" TIMESTAMP(3);
ALTER TABLE "loaner_cars" ADD COLUMN "revisioneScadenza" TIMESTAMP(3);
ALTER TABLE "loaner_cars" ADD COLUMN "manutenzioneScadenza" TIMESTAMP(3);
ALTER TABLE "loaner_cars" ADD COLUMN "note" TEXT;
ALTER TABLE "loaner_cars" ADD COLUMN "statoManuale" "LoanerCarStatoManuale";
ALTER TABLE "loaner_cars" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "loaner_car_photos" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "loanerCarId" TEXT NOT NULL REFERENCES "loaner_cars"("id"),
  "content" BYTEA NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "loaner_car_photos_tenantId_idx" ON "loaner_car_photos"("tenantId");
CREATE INDEX "loaner_car_photos_loanerCarId_idx" ON "loaner_car_photos"("loanerCarId");

-- loaner_bookings: aggiungi tutte le colonne nuove come nullable,
-- riempile dai dati esistenti, POI applica i vincoli NOT NULL.
ALTER TABLE "loaner_bookings" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "dataInizioPrevista" TIMESTAMP(3);
ALTER TABLE "loaner_bookings" ADD COLUMN "dataFinePrevista" TIMESTAMP(3);
ALTER TABLE "loaner_bookings" ADD COLUMN "dataConsegna" TIMESTAMP(3);
ALTER TABLE "loaner_bookings" ADD COLUMN "kmIniziali" INTEGER;
ALTER TABLE "loaner_bookings" ADD COLUMN "carburanteIniziale" "LoanerFuelLevel";
ALTER TABLE "loaner_bookings" ADD COLUMN "firmaClienteDataUrl" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "firmatarioNome" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "dataRestituzione" TIMESTAMP(3);
ALTER TABLE "loaner_bookings" ADD COLUMN "kmFinali" INTEGER;
ALTER TABLE "loaner_bookings" ADD COLUMN "carburanteFinale" "LoanerFuelLevel";
ALTER TABLE "loaner_bookings" ADD COLUMN "danniRiscontrati" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "noteRestituzione" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "costoInternoCents" INTEGER;
ALTER TABLE "loaner_bookings" ADD COLUMN "attribuitoProfitRecordId" TEXT;
ALTER TABLE "loaner_bookings" ADD COLUMN "stato" "LoanerBookingStato";
ALTER TABLE "loaner_bookings" ADD COLUMN "creataDaId" TEXT REFERENCES "users"("id");
ALTER TABLE "loaner_bookings" ADD COLUMN "createdAt" TIMESTAMP(3);
ALTER TABLE "loaner_bookings" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill dai dati esistenti: ogni prenotazione già presente diventa
-- "consegnata subito" (comportamento del vecchio flusso, che non aveva
-- una fase di sola prenotazione) e chiusa/aperta secondo dataFine.
UPDATE "loaner_bookings" b
SET
  "tenantId" = lc."tenantId",
  "dataInizioPrevista" = b."dataInizio",
  "dataConsegna" = b."dataInizio",
  "dataRestituzione" = b."dataFine",
  "stato" = (CASE WHEN b."dataFine" IS NULL THEN 'ASSEGNATA' ELSE 'RESTITUITA' END)::"LoanerBookingStato",
  "createdAt" = b."dataInizio",
  "updatedAt" = COALESCE(b."dataFine", b."dataInizio")
FROM "loaner_cars" lc
WHERE lc.id = b."loanerCarId";

ALTER TABLE "loaner_bookings" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "loaner_bookings" ALTER COLUMN "dataInizioPrevista" SET NOT NULL;
ALTER TABLE "loaner_bookings" ALTER COLUMN "stato" SET NOT NULL;
ALTER TABLE "loaner_bookings" ALTER COLUMN "stato" SET DEFAULT 'PRENOTATA';
ALTER TABLE "loaner_bookings" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "loaner_bookings" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "loaner_bookings" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id");
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id");

CREATE INDEX "loaner_bookings_tenantId_idx" ON "loaner_bookings"("tenantId");
CREATE INDEX "loaner_bookings_vehicleId_idx" ON "loaner_bookings"("vehicleId");
CREATE INDEX "loaner_bookings_clientId_idx" ON "loaner_bookings"("clientId");

CREATE TABLE "loaner_booking_photos" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id"),
  "bookingId" TEXT NOT NULL REFERENCES "loaner_bookings"("id"),
  "fase" "LoanerPhotoFase" NOT NULL,
  "content" BYTEA NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "loaner_booking_photos_tenantId_idx" ON "loaner_booking_photos"("tenantId");
CREATE INDEX "loaner_booking_photos_bookingId_idx" ON "loaner_booking_photos"("bookingId");

ALTER TABLE "loaner_car_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loaner_booking_photos" ENABLE ROW LEVEL SECURITY;
