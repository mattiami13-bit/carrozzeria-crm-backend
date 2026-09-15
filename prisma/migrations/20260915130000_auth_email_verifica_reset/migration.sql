-- Verifica email e reset password: token opachi generati server-side,
-- con scadenza, mai riutilizzabili dopo il consumo (impostati a NULL).
ALTER TABLE "users" ADD COLUMN "emailVerificata" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "emailVerificaToken" TEXT;
ALTER TABLE "users" ADD COLUMN "emailVerificaScadenza" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "resetPasswordToken" TEXT;
ALTER TABLE "users" ADD COLUMN "resetPasswordScadenza" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_emailVerificaToken_key" ON "users"("emailVerificaToken");
CREATE UNIQUE INDEX "users_resetPasswordToken_key" ON "users"("resetPasswordToken");

-- Gli utenti già esistenti hanno già usato il prodotto prima che questa
-- funzionalità esistesse: non ha senso obbligarli a riverificare
-- retroattivamente l'email, quindi li marchiamo come già verificati.
UPDATE "users" SET "emailVerificata" = true;
