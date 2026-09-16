// Punto 39 (feature flag centralizzate): crea i flag che il codice
// referenzia già, attivi di default. isFeatureEnabled (src/lib/
// featureFlags.js) è fail-closed — un flag mancante blocca invece di
// lasciare passare — quindi qualsiasi flag collegato a una rotta già
// in produzione DEVE esistere prima che quella riga sia deployata,
// altrimenti spegnerebbe per errore una funzione già in uso dai
// clienti. Idempotente: usa upsert, sicuro da rieseguire.

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const FLAG = {
  chiave: "ai_copilot_attivo",
  descrizione: "Interruttore operativo per l'AI Copilot, indipendente dal piano — kill-switch in caso di problemi col provider AI o costi anomali (vedi punto 41).",
  abilitataGlobalmente: true,
  piani: [],
  ambienti: [],
};

async function main() {
  const flag = await prisma.featureFlag.upsert({
    where: { chiave: FLAG.chiave },
    create: FLAG,
    update: {},
  });
  console.log(`Flag pronto: ${flag.chiave} (abilitataGlobalmente: ${flag.abilitataGlobalmente})`);
}

main()
  .catch((err) => {
    console.error("Errore:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
