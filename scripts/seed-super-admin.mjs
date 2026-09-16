// Punto 31 del prompt SaaS ("seed super-admin"): crea il PRIMO account
// super-admin in modo sicuro. Nessuna credenziale hardcoded: email e
// password arrivano sempre da variabili d'ambiente lette al momento
// dell'esecuzione, mai scritte nel codice o in un file versionato.
//
// Uso:
//   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... node scripts/seed-super-admin.mjs
//
// Se SUPER_ADMIN_PASSWORD non è impostata, lo script genera una password
// casuale sicura e la stampa UNA SOLA VOLTA a schermo (mai salvata da
// nessuna parte in chiaro) — da cambiare al primo accesso.
//
// Procedura one-time: si rifiuta di eseguire se esiste già un
// super-admin, per evitare di crearne un secondo per errore in
// produzione. Per aggiungerne un altro in futuro serve un intervento
// esplicito (es. tramite un secondo super-admin già autenticato — non
// ancora costruito, vedi SUPER-ADMIN.md), non questo script.

import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

function generaPasswordSicura() {
  // 24 caratteri, alfabeto ampio: nessuna ambiguità visiva critica ma
  // comunque ad alta entropia (~140 bit), pensata per essere copiata
  // subito in un gestore password, non digitata a mano più volte.
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from(crypto.randomFillSync(new Uint8Array(24)))
    .map((b) => alfabeto[b % alfabeto.length])
    .join("");
}

async function main() {
  const esistente = await prisma.superAdmin.findFirst();
  if (esistente) {
    throw new Error(
      `Esiste già un super-admin (${esistente.email}, creato il ${esistente.createdAt.toISOString()}). ` +
      `Procedura one-time: questo script si ferma qui per non crearne un secondo per errore.`
    );
  }

  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Imposta SUPER_ADMIN_EMAIL a un indirizzo email valido prima di eseguire lo script.");
  }

  let password = process.env.SUPER_ADMIN_PASSWORD;
  let generata = false;
  if (!password) {
    password = generaPasswordSicura();
    generata = true;
  } else if (password.length < 16) {
    throw new Error("SUPER_ADMIN_PASSWORD deve avere almeno 16 caratteri per un account con accesso a tutti i tenant.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const superAdmin = await prisma.superAdmin.create({ data: { email, passwordHash } });

  console.log(`Super-admin creato: ${superAdmin.email} (id ${superAdmin.id})`);
  if (generata) {
    console.log("\nPassword generata automaticamente (salvala ORA in un gestore password, non verrà mostrata di nuovo):");
    console.log(password);
  } else {
    console.log("Password: quella fornita in SUPER_ADMIN_PASSWORD.");
  }
}

main()
  .catch((err) => {
    console.error("Errore:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
