import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

// Istanza singola condivisa tra tutte le route, come da best practice Prisma
// per evitare di esaurire le connessioni al database in dev con hot-reload.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });