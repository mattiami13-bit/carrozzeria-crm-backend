import { prisma } from "./prisma.js";

// Punto 41 (cost control AI): "Dashboard: COSTO AI OGGI, MESE, PER
// TENANT, PER FUNZIONE, PER PIANO" — esattamente le 5 viste richieste,
// tutte calcolate dalla stessa tabella AiCostLog (punto 41), mai numeri
// ricalcolati da un listino corrente: costoStimatoUsd è già il costo
// storico al momento della chiamata.
function inizioGiornoCorrente() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function inizioMeseCorrente() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function dashboardCostoAi() {
  const inizioGiorno = inizioGiornoCorrente();
  const inizioMese = inizioMeseCorrente();

  const [totaleOggi, totaleMese, perTenantGrouped, perFunzioneGrouped, tenants] = await Promise.all([
    prisma.aiCostLog.aggregate({ where: { createdAt: { gte: inizioGiorno } }, _sum: { costoStimatoUsd: true } }),
    prisma.aiCostLog.aggregate({ where: { createdAt: { gte: inizioMese } }, _sum: { costoStimatoUsd: true } }),
    prisma.aiCostLog.groupBy({ by: ["tenantId"], where: { createdAt: { gte: inizioMese } }, _sum: { costoStimatoUsd: true }, _count: { _all: true } }),
    prisma.aiCostLog.groupBy({ by: ["funzione"], where: { createdAt: { gte: inizioMese } }, _sum: { costoStimatoUsd: true }, _count: { _all: true } }),
    prisma.tenant.findMany({ select: { id: true, ragioneSociale: true, piano: true } }),
  ]);

  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const perTenant = perTenantGrouped
    .map((r) => ({
      tenantId: r.tenantId,
      ragioneSociale: tenantById.get(r.tenantId)?.ragioneSociale ?? "(tenant eliminato)",
      costoUsd: Number(r._sum.costoStimatoUsd ?? 0),
      richieste: r._count._all,
    }))
    .sort((a, b) => b.costoUsd - a.costoUsd);

  const perFunzione = perFunzioneGrouped
    .map((r) => ({ funzione: r.funzione, costoUsd: Number(r._sum.costoStimatoUsd ?? 0), richieste: r._count._all }))
    .sort((a, b) => b.costoUsd - a.costoUsd);

  // "Per piano" non è una colonna diretta su AiCostLog (il piano di un
  // tenant cambia nel tempo): aggregato qui sommando perTenant secondo
  // il piano ATTUALE di ciascuno, la vista utile per capire quale fascia
  // di abbonamento genera più costo AI oggi.
  const perPianoMap = new Map();
  for (const r of perTenantGrouped) {
    const piano = tenantById.get(r.tenantId)?.piano ?? "SCONOSCIUTO";
    const attuale = perPianoMap.get(piano) ?? { piano, costoUsd: 0, richieste: 0 };
    attuale.costoUsd += Number(r._sum.costoStimatoUsd ?? 0);
    attuale.richieste += r._count._all;
    perPianoMap.set(piano, attuale);
  }
  const perPiano = Array.from(perPianoMap.values()).sort((a, b) => b.costoUsd - a.costoUsd);

  return {
    costoOggiUsd: Number(totaleOggi._sum.costoStimatoUsd ?? 0),
    costoMeseUsd: Number(totaleMese._sum.costoStimatoUsd ?? 0),
    perTenant,
    perFunzione,
    perPiano,
  };
}
