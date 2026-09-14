-- Auto Sostitutive (loaner cars) module: enrich the fleet vehicles, turn the
-- minimal bookings into full assignments (client + practice + delivery/return
-- state + signature + photos + damages) and add the internal-cost fields used
-- to attribute the loaner cost to a practice in the Profit Tracker.

-- CreateEnum
CREATE TYPE "LoanerStatus" AS ENUM ('DISPONIBILE', 'PRENOTATA', 'ASSEGNATA', 'MANUTENZIONE', 'NON_DISPONIBILE');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('BENZINA', 'DIESEL', 'GPL', 'METANO', 'ELETTRICO', 'IBRIDA');

-- CreateEnum
CREATE TYPE "LoanerBookingStatus" AS ENUM ('PRENOTATA', 'ASSEGNATA', 'RESTITUITA', 'ANNULLATA');

-- AlterTable loaner_cars
ALTER TABLE "loaner_cars"
  DROP COLUMN "disponibile",
  ADD COLUMN "km" INTEGER,
  ADD COLUMN "carburante" "FuelType",
  ADD COLUMN "stato" "LoanerStatus" NOT NULL DEFAULT 'DISPONIBILE',
  ADD COLUMN "assicurazioneCompagnia" TEXT,
  ADD COLUMN "assicurazioneScadenza" TIMESTAMP(3),
  ADD COLUMN "revisioneScadenza" TIMESTAMP(3),
  ADD COLUMN "manutenzioneNote" TEXT,
  ADD COLUMN "manutenzioneScadenza" TIMESTAMP(3),
  ADD COLUMN "manutenzioneKm" INTEGER,
  ADD COLUMN "costoGiornalieroCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "foto" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "attiva" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable loaner_bookings
ALTER TABLE "loaner_bookings"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "vehicleId" TEXT,
  ADD COLUMN "stato" "LoanerBookingStatus" NOT NULL DEFAULT 'PRENOTATA',
  ADD COLUMN "dataFinePrevista" TIMESTAMP(3),
  ADD COLUMN "dataConsegna" TIMESTAMP(3),
  ADD COLUMN "dataRestituzione" TIMESTAMP(3),
  ADD COLUMN "kmIniziali" INTEGER,
  ADD COLUMN "kmFinali" INTEGER,
  ADD COLUMN "carburanteIniziale" INTEGER,
  ADD COLUMN "carburanteFinale" INTEGER,
  ADD COLUMN "firmaClienteDataUrl" TEXT,
  ADD COLUMN "firmatarioNome" TEXT,
  ADD COLUMN "firmaAt" TIMESTAMP(3),
  ADD COLUMN "fotoConsegna" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "fotoRestituzione" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "danni" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "note" TEXT,
  ADD COLUMN "costoGiornalieroCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "costoTotaleCents" INTEGER,
  ADD COLUMN "attribuitaAllaPratica" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rename the old close-out column to the richer return timestamp.
ALTER TABLE "loaner_bookings" RENAME COLUMN "dataFine" TO "dataRestituzioneLegacy";
UPDATE "loaner_bookings" SET "dataRestituzione" = "dataRestituzioneLegacy" WHERE "dataRestituzioneLegacy" IS NOT NULL;
ALTER TABLE "loaner_bookings" DROP COLUMN "dataRestituzioneLegacy";

-- Backfill tenantId on existing bookings from the parent car, then enforce NOT NULL.
UPDATE "loaner_bookings" b SET "tenantId" = c."tenantId" FROM "loaner_cars" c WHERE b."loanerCarId" = c."id" AND b."tenantId" IS NULL;
ALTER TABLE "loaner_bookings" ALTER COLUMN "tenantId" SET NOT NULL;

-- clientId becomes optional (a pure reservation has no client yet).
ALTER TABLE "loaner_bookings" ALTER COLUMN "clientId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "loaner_cars_tenantId_stato_idx" ON "loaner_cars"("tenantId", "stato");
CREATE INDEX "loaner_bookings_tenantId_idx" ON "loaner_bookings"("tenantId");
CREATE INDEX "loaner_bookings_loanerCarId_idx" ON "loaner_bookings"("loanerCarId");
CREATE INDEX "loaner_bookings_tenantId_vehicleId_idx" ON "loaner_bookings"("tenantId", "vehicleId");

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
