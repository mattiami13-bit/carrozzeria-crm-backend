ALTER TABLE "tenants" ADD COLUMN "eliminazioneRichiestaAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "eliminazionePrevistaPer" TIMESTAMP(3);

ALTER TYPE "GdprRichiestaStato" ADD VALUE 'ANNULLATA';
