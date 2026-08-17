import crypto from "crypto";
import { prisma } from "./prisma.js";

// Restituisce il link pubblico del portale per un veicolo, creando il
// token se non esiste ancora (mai rigenerato se già presente, per non
// invalidare link già inviati al cliente). Usata sia dalla route che lo
// staff chiama manualmente, sia dalle notifiche automatiche.
export async function getPortalLink(baseUrl, tenantId, vehicleId) {
  let access = await prisma.portalAccess.findFirst({
    where: { vehicleId, attivo: true },
  });

  if (!access) {
    const token = crypto.randomBytes(32).toString("hex");
    access = await prisma.portalAccess.create({
      data: { tenantId, vehicleId, token },
    });
  }

  return `${baseUrl}/portale/?t=${access.token}`;
}