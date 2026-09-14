import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";
import { isBlocking } from "../lib/parts-tracking.js";
import { STAGE_ORDER } from "./vehicles.js";

// "Carrozzeria Live": board di sola lettura pensata per un monitor/TV in
// officina. Nessuna scrittura qui — legge solo dati già calcolati altrove
// (stadio pratica, tecnico assegnato/in corso, ricambi bloccanti, ultima
// previsione del Predictive Delay AI) e li aggrega in una riga per
// veicolo. Il client fa polling periodico per l'aggiornamento automatico.

export const liveDashboardRouter = Router();
liveDashboardRouter.use(requireAuth);

const STATO_LABEL = {
  ACCETTAZIONE: "Accettazione", PREVENTIVO: "Preventivo", ATTESA_APPROVAZIONE: "Approvazione",
  ORDINE_RICAMBI: "Ricambi", IN_LAVORAZIONE: "Lavorazione", PREPARAZIONE: "Preparazione",
  VERNICIATURA: "Verniciatura", LUCIDATURA: "Lucidatura", CONTROLLO_QUALITA: "Controllo qualità",
  LAVAGGIO: "Lavaggio", PRONTA_CONSEGNA: "Pronta", CONSEGNATA: "Consegnata",
};

// Reparto stimato dallo stadio pratica quando non c'è una lavorazione
// (WorkOrder) attiva a indicarlo con precisione: una stima ragionevole,
// non un dato autorevole — assegnare una lavorazione dà un reparto certo.
const REPARTO_DA_STAGE = {
  IN_LAVORAZIONE: "CARROZZERIA", PREPARAZIONE: "CARROZZERIA",
  VERNICIATURA: "VERNICIATURA",
  LUCIDATURA: "FINITURA", CONTROLLO_QUALITA: "FINITURA", LAVAGGIO: "FINITURA",
};

// Stessa soglia usata da src/lib/delay.js predict() per il "band" della
// previsione (risk<=30 verde, <=60 arancione, altrimenti rosso) — qui
// replicata per non dover ricalcolare l'intera previsione solo per
// leggerne il colore.
function bandDaRisk(risk) {
  if (risk == null) return null;
  return risk <= 30 ? "verde" : risk <= 60 ? "arancione" : "rosso";
}

function avanzamentoDaStage(stage) {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0) return 0;
  return Math.round((i / (STAGE_ORDER.length - 1)) * 100);
}

// GET /api/live-dashboard — una riga per ogni pratica non ancora
// consegnata. Il cliente (nome/telefono) viene sempre incluso qui perché
// la route richiede autenticazione staff: è il FRONTEND che deve
// nasconderlo di default (Modalità Officina) prima di mostrare la board
// su un monitor visibile ai clienti.
liveDashboardRouter.get("/", async (req, res) => {
  const { tenantId } = tenantScope(req);
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);

  const vehicles = await prisma.vehicle.findMany({
    where: { tenantId, stage: { not: "CONSEGNATA" } },
    select: {
      id: true, marca: true, modello: true, targa: true, stage: true, dataPrevistaConsegna: true,
      client: { select: { nome: true, cognome: true, telefono: true } },
      tecnico: { select: { id: true, nome: true, cognome: true } },
      trackedParts: { select: { status: true, data: true } },
      workOrders: {
        where: { stato: { in: ["IN_CORSO", "IN_PAUSA"] } },
        select: { reparto: true, titolo: true, stato: true, tecnico: { select: { id: true, nome: true, cognome: true } } },
        orderBy: { updatedAt: "desc" },
      },
      delayForecasts: { orderBy: { createdAt: "desc" }, take: 1, select: { risk: true, estimatedDate: true } },
    },
    orderBy: { dataPrevistaConsegna: "asc" },
  });

  const righe = vehicles.map((v) => {
    const lavorazioneAttiva = v.workOrders.find((w) => w.stato === "IN_CORSO") || v.workOrders[0] || null;
    const tecnico = lavorazioneAttiva?.tecnico || v.tecnico || null;
    const reparto = lavorazioneAttiva?.reparto || REPARTO_DA_STAGE[v.stage] || null;

    const partiBloccanti = v.trackedParts.filter((p) => isBlocking(p));
    const bloccoAttivo = partiBloccanti.length > 0;
    const bloccoDescrizione = partiBloccanti.map((p) => p.data.description).filter(Boolean).slice(0, 2).join(", ") || null;

    const forecast = v.delayForecasts[0] || null;
    const bandPrevisione = forecast ? bandDaRisk(forecast.risk) : null;

    const consegnaPassata = v.dataPrevistaConsegna && new Date(v.dataPrevistaConsegna) < oggi;
    const consegnaEntroDomani = v.dataPrevistaConsegna && !consegnaPassata &&
      (new Date(v.dataPrevistaConsegna) - oggi) <= 2 * 24 * 60 * 60 * 1000 && v.stage !== "PRONTA_CONSEGNA";

    // Semaforo complessivo della riga: un blocco attivo o una consegna già
    // superata sono sempre rossi (fatti oggettivi); altrimenti si usa la
    // previsione del Predictive Delay AI quando disponibile, o una
    // scadenza ravvicinata come segnale di attenzione.
    let semaforo = "verde";
    if (bloccoAttivo || consegnaPassata || bandPrevisione === "rosso") semaforo = "rosso";
    else if (bandPrevisione === "arancione" || consegnaEntroDomani) semaforo = "arancione";

    return {
      vehicleId: v.id,
      veicolo: `${v.marca} ${v.modello}`,
      targa: v.targa,
      stage: v.stage,
      stato: STATO_LABEL[v.stage] || v.stage,
      reparto,
      tecnico: tecnico ? { id: tecnico.id, nome: tecnico.nome, cognome: tecnico.cognome } : null,
      dataConsegna: v.dataPrevistaConsegna,
      avanzamento: avanzamentoDaStage(v.stage),
      blocco: { attivo: bloccoAttivo, descrizione: bloccoDescrizione },
      semaforo,
      cliente: v.client ? { nome: v.client.nome, cognome: v.client.cognome, telefono: v.client.telefono } : null,
    };
  });

  res.json(righe);
});
