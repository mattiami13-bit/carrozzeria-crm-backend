import { prisma } from "./prisma.js";
import { LIMITE_ASSISTENTE_DEFAULT, LIMITE_ANALISI_IA_DEFAULT } from "./aiUsage.js";

// Punto 40 (usage tracking, "Super Admin deve vedere usage per tenant"):
// un riepilogo per tenant delle 6 categorie richieste dal prompt (AI,
// storage, WhatsApp, email, documenti, API esterne). Riusa le tabelle
// che già esistono per AI/WhatsApp/documenti (nessuna duplicazione),
// UsageEvent solo per email e API esterne, che non avevano ancora
// nessuna traccia in database.
//
// "storage" è un conteggio di foto/documenti, non byte esatti: misurare
// lo spazio reale richiederebbe interrogare Supabase Storage bucket per
// bucket (nessuna API di riepilogo aggregato disponibile con le
// credenziali del progetto) — onestamente fuori scope per questo punto,
// dichiarato tale invece di presentare un numero stimato come esatto.
function inizioMeseCorrente() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mappaConteggio(righe) {
  const mappa = new Map();
  for (const r of righe) mappa.set(r.tenantId, r._count._all);
  return mappa;
}

export async function riepilogoUsoTuttiTenant() {
  const inizioMese = inizioMeseCorrente();

  const [
    tenants,
    assistenteMese,
    analisiMese,
    whatsappMese,
    emailMese,
    apiEsterneMese,
    documentiPerTenant,
    fotoPerTenant,
  ] = await Promise.all([
    prisma.tenant.findMany({
      select: { id: true, ragioneSociale: true, piano: true, limiteAssistenteIAMensile: true, limiteAnalisiIAMensile: true },
      orderBy: { ragioneSociale: "asc" },
    }),
    prisma.aiAssistantLog.groupBy({ by: ["tenantId"], where: { createdAt: { gte: inizioMese } }, _count: { _all: true } }),
    prisma.aiAnalysisLog.groupBy({ by: ["tenantId"], where: { createdAt: { gte: inizioMese } }, _count: { _all: true } }),
    prisma.whatsappMessage.groupBy({ by: ["tenantId"], where: { createdAt: { gte: inizioMese } }, _count: { _all: true } }),
    prisma.usageEvent.groupBy({ by: ["tenantId"], where: { tipo: "EMAIL", createdAt: { gte: inizioMese } }, _count: { _all: true } }),
    prisma.usageEvent.groupBy({ by: ["tenantId"], where: { tipo: "API_ESTERNA", createdAt: { gte: inizioMese } }, _count: { _all: true } }),
    // Document/Photo non hanno tenantId diretto (via client/vehicle):
    // un JOIN in SQL grezzo è più corretto ed efficiente che scaricare
    // ogni riga in JS solo per contarla.
    prisma.$queryRaw`SELECT c."tenantId" as "tenantId", COUNT(*)::int as count FROM documents d JOIN clients c ON c.id = d."clientId" GROUP BY c."tenantId"`,
    prisma.$queryRaw`SELECT v."tenantId" as "tenantId", COUNT(*)::int as count FROM photos p JOIN vehicles v ON v.id = p."vehicleId" GROUP BY v."tenantId"`,
  ]);

  const mAssistente = mappaConteggio(assistenteMese);
  const mAnalisi = mappaConteggio(analisiMese);
  const mWhatsapp = mappaConteggio(whatsappMese);
  const mEmail = mappaConteggio(emailMese);
  const mApiEsterne = mappaConteggio(apiEsterneMese);
  const mDocumenti = new Map(documentiPerTenant.map((r) => [r.tenantId, r.count]));
  const mFoto = new Map(fotoPerTenant.map((r) => [r.tenantId, r.count]));

  return tenants.map((t) => {
    const limiteAssistente = t.limiteAssistenteIAMensile ?? LIMITE_ASSISTENTE_DEFAULT[t.piano] ?? 0;
    const limiteAnalisi = t.limiteAnalisiIAMensile ?? LIMITE_ANALISI_IA_DEFAULT[t.piano] ?? 0;
    const assistenteUsateMese = mAssistente.get(t.id) ?? 0;
    const analisiUsateMese = mAnalisi.get(t.id) ?? 0;
    return {
      tenantId: t.id,
      ragioneSociale: t.ragioneSociale,
      piano: t.piano,
      ai: {
        assistenteUsateMese, assistenteLimite: limiteAssistente,
        assistenteOltreLimite: assistenteUsateMese >= limiteAssistente,
        analisiUsateMese, analisiLimite: limiteAnalisi,
        analisiOltreLimite: analisiUsateMese >= limiteAnalisi,
      },
      whatsapp: { mese: mWhatsapp.get(t.id) ?? 0 },
      email: { mese: mEmail.get(t.id) ?? 0 },
      apiEsterne: { mese: mApiEsterne.get(t.id) ?? 0 },
      documenti: { totale: mDocumenti.get(t.id) ?? 0 },
      foto: { totale: mFoto.get(t.id) ?? 0 },
    };
  });
}
