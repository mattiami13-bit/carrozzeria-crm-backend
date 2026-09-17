// Punto 44 (migrazioni database, "prima di migration distruttive:
// backup, compatibilità, rollback plan"): controllo automatico da far
// girare prima di "prisma migrate deploy" in produzione. A differenza
// di "prisma migrate dev" (interattivo, in locale), "migrate deploy"
// non avvisa mai di una modifica distruttiva — questo script colma
// quel vuoto per il caso reale che conta: il deploy non interattivo.
//
// Non blocca da solo (uno script non può sapere se un backup è stato
// davvero verificato): elenca le migrazioni non ancora applicate che
// contengono pattern SQL potenzialmente distruttivi, e si ferma finché
// non confermi esplicitamente di aver seguito la checklist con
// CONFERMA_MIGRAZIONE_DISTRUTTIVA=1.
//
// Uso:
//   node scripts/check-migrazioni-distruttive.mjs
//   CONFERMA_MIGRAZIONE_DISTRUTTIVA=1 node scripts/check-migrazioni-distruttive.mjs && npx prisma migrate deploy

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

// Pattern deliberatamente ampi (falsi positivi accettabili: meglio un
// controllo in più su una migrazione innocua che uno mancato su una
// pericolosa). Non copre tutto SQL possibile, è un aiuto alla revisione
// umana, non un sostituto.
const PATTERN_DISTRUTTIVI = [
  { re: /DROP\s+TABLE/i, motivo: "elimina una tabella intera" },
  { re: /DROP\s+COLUMN/i, motivo: "elimina una colonna (perdita dei dati in quella colonna)" },
  { re: /TRUNCATE/i, motivo: "svuota una tabella" },
  { re: /ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE/i, motivo: "cambia il tipo di una colonna (può troncare/convertire dati esistenti)" },
  { re: /ALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL/i, motivo: "rende una colonna obbligatoria (fallisce, o scarta, se esistono righe con NULL)" },
  { re: /DROP\s+CONSTRAINT/i, motivo: "rimuove un vincolo (rivedere cosa lo sostituisce, se qualcosa)" },
  { re: /DROP\s+TYPE/i, motivo: "elimina un enum: qualsiasi riga che lo usa ancora causerebbe un errore" },
];

async function migrazioniGiaApplicate() {
  try {
    const righe = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    return new Set(righe.map((r) => r.migration_name));
  } catch {
    // Tabella assente = nessuna migrazione applicata ancora (progetto nuovissimo).
    return new Set();
  }
}

async function main() {
  const applicate = await migrazioniGiaApplicate();
  const cartelle = fs.readdirSync(MIGRATIONS_DIR).filter((nome) => fs.statSync(path.join(MIGRATIONS_DIR, nome)).isDirectory());
  const daApplicare = cartelle.filter((nome) => !applicate.has(nome)).sort();

  if (daApplicare.length === 0) {
    console.log("Nessuna migrazione in attesa: niente da controllare.");
    return;
  }

  const trovate = [];
  for (const cartella of daApplicare) {
    const sqlPath = path.join(MIGRATIONS_DIR, cartella, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf-8");
    const motivi = PATTERN_DISTRUTTIVI.filter((p) => p.re.test(sql)).map((p) => p.motivo);
    if (motivi.length) trovate.push({ cartella, motivi });
  }

  console.log(`${daApplicare.length} migrazione/i in attesa di essere applicata/e: ${daApplicare.join(", ")}`);

  if (trovate.length === 0) {
    console.log("Nessun pattern potenzialmente distruttivo trovato. OK per procedere.");
    return;
  }

  console.log("\n⚠️  Trovati pattern potenzialmente DISTRUTTIVI:");
  for (const { cartella, motivi } of trovate) {
    console.log(`\n  ${cartella}:`);
    for (const m of motivi) console.log(`    - ${m}`);
  }

  console.log(`
Prima di procedere, verifica (punto 44 del prompt SaaS):
  [ ] BACKUP: esiste un backup recente e ripristinabile (Supabase →
      Database → Backups — vedi BACKUP-DISASTER-RECOVERY.md). Per una
      modifica importante, valuta di scaricare/verificare uno snapshot
      appena prima del deploy, non fidarti solo del backup notturno.
  [ ] COMPATIBILITÀ: il codice già in esecuzione in produzione (la
      versione PRIMA di questo deploy) continua a funzionare con lo
      schema dopo la migrazione? Se una colonna diventa NOT NULL o
      cambia tipo, il codice vecchio che non la imposta ancora
      romperebbe le scritture — preferire un cambiamento in due passi
      (aggiungi nullable → backfill → rendi obbligatoria in una
      migrazione successiva, dopo che il nuovo codice è già in
      produzione) invece di un unico passo distruttivo.
  [ ] ROLLBACK PLAN: se qualcosa va storto subito dopo il deploy, sai
      esattamente come tornare indietro? Prisma non genera migrazioni
      "down" automatiche — per una DROP COLUMN, il rollback reale è
      "ripristina il backup", non "rigenera la colonna vuota": scrivilo
      per iscritto ORA, non improvvisarlo sotto pressione se serve.

Se hai verificato tutti e tre i punti, rilancia con:
  CONFERMA_MIGRAZIONE_DISTRUTTIVA=1 node scripts/check-migrazioni-distruttive.mjs
`);

  if (process.env.CONFERMA_MIGRAZIONE_DISTRUTTIVA !== "1") {
    process.exitCode = 1;
    return;
  }
  console.log("Confermato: procedi pure con `npx prisma migrate deploy`.");
}

main()
  .catch((err) => { console.error("Errore:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
