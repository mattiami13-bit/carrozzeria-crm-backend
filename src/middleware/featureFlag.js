import { prisma } from "../lib/prisma.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import { tenantIdOpzionale } from "./auth.js";

// Punto 39: gate operativo (rollout/kill-switch), indipendente da
// requireFeature (punto 29, gate di billing) — le due cose rispondono
// a domande diverse e possono essere applicate insieme sulla stessa
// rotta senza conflitto.
export function requireFlag(chiave) {
  return async function (req, res, next) {
    const tenantId = tenantIdOpzionale(req);
    if (!tenantId) return next();

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { piano: true } });
    if (!tenant) return next();

    const abilitata = await isFeatureEnabled(chiave, { tenantId, piano: tenant.piano });
    if (!abilitata) {
      return res.status(403).json({ error: "Questa funzione non è disponibile al momento.", flag: chiave });
    }
    next();
  };
}
