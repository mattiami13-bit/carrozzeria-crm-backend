import { PrismaClient } from "@prisma/client";

// Istanza singola condivisa tra tutte le route, come da best practice Prisma
// per evitare di esaurire le connessioni al database in dev con hot-reload.
export const prisma = new PrismaClient();
