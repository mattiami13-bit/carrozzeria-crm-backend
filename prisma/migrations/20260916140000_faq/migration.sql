CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "domanda" TEXT NOT NULL,
    "risposta" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "faq_items" ENABLE ROW LEVEL SECURITY;
