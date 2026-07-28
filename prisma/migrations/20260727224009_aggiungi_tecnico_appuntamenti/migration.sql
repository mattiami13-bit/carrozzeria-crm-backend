-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "tecnicoId" TEXT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
