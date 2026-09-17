import { prisma } from "./prisma.js";
import { creaNotificaRuoli } from "./notificheInApp.js";

// Punto 40 (usage tracking, "limiti e alert"): fonte unica per i limiti
// mensili delle due quote AI dell'app (domande assistente/copilot e
// analisi IA foto/danni/gap assicurativo) — prima erano duplicati
// identici in 5 file diversi (copilot.js, assistente.js,
// damageAssistant.js, insuranceGap.js, vehicles.js), stesso rischio già
// visto al punto 29 con PROFESSIONAL/ENTERPRISE: una modifica a una
// copia e non alle altre avrebbe silenziosamente disallineato il
// limite reale da quello applicato altrove.
export const LIMITE_ASSISTENTE_DEFAULT = { TRIAL: 20, STARTER: 100, PRO: 500, PREMIUM_AI: 2000 };
export const LIMITE_ANALISI_IA_DEFAULT = { TRIAL: 5, STARTER: 20, PRO: 100, PREMIUM_AI: 500 };

function inizioMeseCorrente() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function contaDomandeAssistenteQuestoMese(tenantId) {
  return prisma.aiAssistantLog.count({ where: { tenantId, createdAt: { gte: inizioMeseCorrente() } } });
}

export async function contaAnalisiIAQuestoMese(tenantId) {
  return prisma.aiAnalysisLog.count({ where: { tenantId, createdAt: { gte: inizioMeseCorrente() } } });
}

export function limiteAssistente(tenant) {
  return tenant.limiteAssistenteIAMensile ?? LIMITE_ASSISTENTE_DEFAULT[tenant.piano] ?? 0;
}

export function limiteAnalisiIA(tenant) {
  return tenant.limiteAnalisiIAMensile ?? LIMITE_ANALISI_IA_DEFAULT[tenant.piano] ?? 0;
}

// Alert (punto 40): un avviso in-app agli ADMIN/AMMINISTRAZIONE del
// tenant quando l'uso arriva al 90% o al 100% del limite mensile.
// Idempotente per davvero: controlla se esiste già una notifica per
// questa combinazione tenant/quota/soglia/mese prima di crearne una,
// invece di fidarsi solo del fatto che "usate" cresce di 1 alla volta —
// due richieste concorrenti che centrano la stessa soglia non devono
// generare due notifiche identiche.
async function avvisaSeVicinoAlLimite(tenantId, etichetta, usate, limite) {
  if (limite <= 0) return;
  const soglia90 = Math.ceil(limite * 0.9);
  const raggiunto = usate >= limite;
  if (usate !== soglia90 && !(raggiunto && usate === limite)) return;

  const titolo = raggiunto ? "Limite AI mensile raggiunto" : "Limite AI mensile quasi raggiunto";
  // "etichetta" distingue già le due quote (Assistente/Copilot vs
  // Analisi IA) — combinata col titolo (90% vs 100%) e il mese corrente
  // è una chiave di deduplicazione naturale, senza bisogno di un
  // marcatore nascosto nel testo mostrato all'utente.
  const giaInviata = await prisma.notification.findFirst({
    where: { tenantId, categoria: "AI", titolo, messaggio: { startsWith: `${etichetta}:` }, createdAt: { gte: inizioMeseCorrente() } },
    select: { id: true },
  });
  if (giaInviata) return;

  await creaNotificaRuoli({
    tenantId,
    ruoli: ["ADMIN", "AMMINISTRAZIONE"],
    categoria: "AI",
    titolo,
    messaggio: `${etichetta}: ${usate} di ${limite} usate questo mese.${raggiunto ? " Le richieste aggiuntive sono bloccate fino al mese prossimo (o con un upgrade di piano)." : ""}`,
  }).catch((err) => console.error(`[ai-usage] Notifica limite fallita per tenant ${tenantId}:`, err.message));
}

// Da chiamare DOPO aver creato la riga di log (quindi con "usate" già
// comprensivo della richiesta appena fatta) — mai prima del controllo
// di blocco, altrimenti una richiesta respinta genererebbe comunque un
// avviso "limite raggiunto" fuorviante.
export async function segnalaUsoAssistente(tenant, usateDopo) {
  await avvisaSeVicinoAlLimite(tenant.id, "Domande Assistente/Copilot AI", usateDopo, limiteAssistente(tenant));
}

export async function segnalaUsoAnalisiIA(tenant, usateDopo) {
  await avvisaSeVicinoAlLimite(tenant.id, "Analisi IA (danni, gap assicurativo, foto)", usateDopo, limiteAnalisiIA(tenant));
}
