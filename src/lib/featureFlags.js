import { prisma } from "./prisma.js";

// Punto 39 (feature flag centralizzate): valutazione a 4 livelli, dal
// più specifico al più generale — vedi il commento sul modello
// FeatureFlag in schema.prisma per il ragionamento completo.
//
// Fail-closed: una chiave non configurata, o un tenant/piano senza
// override esplicito su un flag disattivato, risultano SEMPRE
// disattivati — mai il contrario. Un flag è per definizione un modo
// per accendere qualcosa con cautela, non deve mai attivarsi da solo
// per una configurazione mancante.
export async function isFeatureEnabled(chiave, { tenantId = null, piano = null } = {}) {
  const flag = await prisma.featureFlag.findUnique({
    where: { chiave },
    include: tenantId ? { overrideTenant: { where: { tenantId } } } : undefined,
  });
  if (!flag) return false;

  // 1. Override per singolo tenant: vince sempre, in entrambe le direzioni.
  if (tenantId && flag.overrideTenant?.length) {
    return flag.overrideTenant[0].abilitata;
  }

  // 2. Ambiente: array vuoto = nessuna restrizione.
  const ambienteCorrente = process.env.APP_ENV || "production";
  if (flag.ambienti.length && !flag.ambienti.includes(ambienteCorrente)) {
    return false;
  }

  // 3. Interruttore globale.
  if (!flag.abilitataGlobalmente) return false;

  // 4. Piani inclusi: array vuoto = nessuna restrizione di piano.
  if (flag.piani.length && piano && !flag.piani.includes(piano)) {
    return false;
  }

  return true;
}
