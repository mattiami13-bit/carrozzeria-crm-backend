-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ACCETTATORE', 'TECNICO', 'AMMINISTRAZIONE');

-- CreateEnum
CREATE TYPE "WorkflowStage" AS ENUM ('ACCETTAZIONE', 'PREVENTIVO', 'ATTESA_APPROVAZIONE', 'ORDINE_RICAMBI', 'IN_LAVORAZIONE', 'PREPARAZIONE', 'VERNICIATURA', 'LUCIDATURA', 'CONTROLLO_QUALITA', 'LAVAGGIO', 'PRONTA_CONSEGNA', 'CONSEGNATA');

-- CreateEnum
CREATE TYPE "FasePhoto" AS ENUM ('PRIMA', 'DURANTE', 'DOPO');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('BOZZA', 'INVIATO', 'ACCETTATO', 'RIFIUTATO');

-- CreateEnum
CREATE TYPE "QuoteItemType" AS ENUM ('MANODOPERA', 'RICAMBIO', 'VERNICE', 'ALTRO');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('CARICO', 'SCARICO');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "ragioneSociale" TEXT NOT NULL,
    "partitaIva" TEXT,
    "piano" "Plan" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cognome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "ruolo" "Role" NOT NULL DEFAULT 'TECNICO',
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cognome" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "codiceFiscale" TEXT,
    "partitaIva" TEXT,
    "indirizzo" TEXT,
    "noteInterne" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modello" TEXT NOT NULL,
    "targa" TEXT NOT NULL,
    "vin" TEXT,
    "colore" TEXT,
    "km" INTEGER,
    "compagniaAssicurativa" TEXT,
    "numeroSinistro" TEXT,
    "perito" TEXT,
    "stage" "WorkflowStage" NOT NULL DEFAULT 'ACCETTAZIONE',
    "tecnicoId" TEXT,
    "dataIngresso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataPrevistaConsegna" TIMESTAMP(3),
    "dataConsegnaEffettiva" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_history" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fromStage" "WorkflowStage",
    "toStage" "WorkflowStage" NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fase" "FasePhoto" NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "stato" "QuoteStatus" NOT NULL DEFAULT 'BOZZA',
    "imponibile" DECIMAL(10,2) NOT NULL,
    "aliquotaIva" DECIMAL(4,2) NOT NULL DEFAULT 22.00,
    "totale" DECIMAL(10,2) NOT NULL,
    "pdfUrl" TEXT,
    "firmatoAt" TIMESTAMP(3),
    "inviatoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tipo" "QuoteItemType" NOT NULL,
    "descrizione" TEXT NOT NULL,
    "quantita" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "prezzoUnitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codice" TEXT NOT NULL,
    "descrizione" TEXT NOT NULL,
    "giacenza" INTEGER NOT NULL DEFAULT 0,
    "scortaMinima" INTEGER NOT NULL DEFAULT 0,
    "prezzoAcquisto" DECIMAL(10,2) NOT NULL,
    "fornitore" TEXT,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_movements" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "tipo" "MovementType" NOT NULL,
    "quantita" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loaner_cars" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modello" TEXT NOT NULL,
    "disponibile" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "loaner_cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loaner_bookings" (
    "id" TEXT NOT NULL,
    "loanerCarId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dataInizio" TIMESTAMP(3) NOT NULL,
    "dataFine" TIMESTAMP(3),

    CONSTRAINT "loaner_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "titolo" TEXT NOT NULL,
    "inizio" TIMESTAMP(3) NOT NULL,
    "fine" TIMESTAMP(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inizio" TIMESTAMP(3) NOT NULL,
    "fine" TIMESTAMP(3),

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_partitaIva_key" ON "tenants"("partitaIva");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "clients_tenantId_idx" ON "clients"("tenantId");

-- CreateIndex
CREATE INDEX "clients_tenantId_telefono_idx" ON "clients"("tenantId", "telefono");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_idx" ON "vehicles"("tenantId");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_targa_idx" ON "vehicles"("tenantId", "targa");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_stage_idx" ON "vehicles"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "stage_history_vehicleId_idx" ON "stage_history"("vehicleId");

-- CreateIndex
CREATE INDEX "photos_vehicleId_idx" ON "photos"("vehicleId");

-- CreateIndex
CREATE INDEX "quotes_tenantId_idx" ON "quotes"("tenantId");

-- CreateIndex
CREATE INDEX "quotes_tenantId_stato_idx" ON "quotes"("tenantId", "stato");

-- CreateIndex
CREATE INDEX "parts_tenantId_idx" ON "parts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "parts_tenantId_codice_key" ON "parts"("tenantId", "codice");

-- CreateIndex
CREATE INDEX "loaner_cars_tenantId_idx" ON "loaner_cars"("tenantId");

-- CreateIndex
CREATE INDEX "appointments_tenantId_idx" ON "appointments"("tenantId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_movements" ADD CONSTRAINT "part_movements_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_cars" ADD CONSTRAINT "loaner_cars_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_loanerCarId_fkey" FOREIGN KEY ("loanerCarId") REFERENCES "loaner_cars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
