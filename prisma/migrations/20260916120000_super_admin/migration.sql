-- Punto 31 (seed super-admin): tabella separata per gli account di
-- livello piattaforma, mai legata a un tenant.
CREATE TABLE "super_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoAccessoAt" TIMESTAMP(3),

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

-- Come le altre tabelle nello schema public, protetta di default anche
-- dall'API REST pubblica di Supabase (vedi commit RLS del 16/09/2026).
ALTER TABLE "super_admins" ENABLE ROW LEVEL SECURITY;
