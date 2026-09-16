import { prisma } from "../lib/prisma.js";
import { haFeature } from "../lib/billing/piani.js";
import { tenantIdOpzionale } from "./auth.js";

// Punto 29 (test automatici, "feature entitlement"): PIANI in
// lib/billing/piani.js descrive quali funzioni include ciascun piano,
// ma finché nessuna rotta lo controlla è solo documentazione — un
// tenant Starter poteva usare Copilot AI o Modalità Tecnico senza
// averli pagati. Questo middleware applica davvero quella matrice.
//
// Stesso schema di requireAbbonamentoAttivo (punto 23): nessun token
// valido -> passa oltre (ci pensa requireAuth a valle); tenant demo
// (punto 28) sempre esente, ha accesso a tutto per definizione.
export function requireFeature(featureKey) {
  return async function (req, res, next) {
    const tenantId = tenantIdOpzionale(req);
    if (!tenantId) return next();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { piano: true, isDemo: true },
    });
    if (!tenant) return next();
    if (tenant.isDemo) return next();

    if (!haFeature(tenant, featureKey)) {
      return res.status(403).json({
        error: "Questa funzione non è inclusa nel tuo piano attuale. Passa a un piano superiore per attivarla.",
        featureRequired: featureKey,
        pianoAttuale: tenant.piano,
      });
    }
    next();
  };
}
