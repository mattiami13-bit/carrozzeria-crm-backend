-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'CLIENTE',
ADD COLUMN     "vehicleId" TEXT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
