-- "dataInizio" era NOT NULL nello schema originale ed è rimasta così anche
-- dopo essere stata smappata da Prisma nella migrazione precedente: le
-- nuove prenotazioni (che non la valorizzano più) fallivano con una
-- violazione NOT NULL. La colonna resta per i dati storici, ma non è più
-- obbligatoria per le righe nuove.
ALTER TABLE "loaner_bookings" ALTER COLUMN "dataInizio" DROP NOT NULL;
