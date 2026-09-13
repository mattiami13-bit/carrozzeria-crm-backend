import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

// AI Copilot: assistente conversazionale sui dati del CRM, separato dal
// vecchio "Assistente Ombra" (routes/assistente.js, widget 💬), che resta
// invariato e continua a funzionare com'è. Il Copilot copre domande più
// ampie (margini, ritardi, disponibilità tecnici) e restituisce, oltre al
// testo, un elenco di "riferimenti" — i record reali che ha consultato —
// così il frontend può mostrare link diretti alla pratica ("Apri pratica",
// "Mostra dettagli", "Contatta cliente", "Visualizza ricambi") senza che il
// modello debba mai inventare un id: i riferimenti vengono dai risultati
// reali degli strumenti, mai dal testo libero del modello.

export const copilotRouter = Router();
copilotRouter.use(requireAuth);

// Stessa quota/piano del vecchio Assistente: stessa risorsa concettuale
// ("fai una domanda in linguaggio naturale sui tuoi dati"), quindi condivide
// il contatore AiAssistantLog e Tenant.limiteAssistenteIAMensile invece di
// introdurne uno nuovo e frammentare la quota tra due assistenti simili.
const LIMITE_ASSISTENTE_DEFAULT = { TRIAL: 20, STARTER: 100, PROFESSIONAL: 500, ENTERPRISE: 2000 };

async function contaDomandeQuestoMese(tenantId) {
  const inizioMese = new Date();
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);
  return prisma.aiAssistantLog.count({ where: { tenantId, createdAt: { gte: inizioMese } } });
}

const RUOLI_CON_ACCESSO_FINANZIARIO = new Set(["ADMIN", "AMMINISTRAZIONE"]);
const STRUMENTI_FINANZIARI = new Set(["margine_veicolo", "preventivi_marginalita_bassa", "fatturato_mensile"]);

// Margine di un preventivo: manodopera/vernice/altro sono considerate
// margine pieno (il gestionale non traccia un costo per la manodopera).
// Per i ricambi, il costo è reale SOLO se troviamo un Part con la stessa
// descrizione esatta a magazzino: se non lo troviamo, quella voce non
// entra nel margine stimato (mai inventare un costo) e viene segnalata
// tramite "vociSenzaCosto" così il modello può dichiarare il dato parziale.
async function calcolaMargineQuote(tenantId, quote) {
  let ricavo = 0, margineStimato = 0, vociSenzaCosto = 0;
  for (const item of quote.items) {
    const riga = Number(item.quantita) * Number(item.prezzoUnitario);
    ricavo += riga;
    if (item.tipo === "RICAMBIO") {
      const part = await prisma.part.findFirst({
        where: { tenantId, descrizione: { equals: item.descrizione, mode: "insensitive" } },
      });
      if (part) margineStimato += riga - Number(item.quantita) * Number(part.prezzoAcquisto);
      else vociSenzaCosto++;
    } else {
      margineStimato += riga;
    }
  }
  const marginePercento = ricavo > 0 ? Number(((margineStimato / ricavo) * 100).toFixed(1)) : null;
  return { ricavo, margineStimato, marginePercento, vociSenzaCosto, datiIncompleti: vociSenzaCosto > 0 };
}

async function giorniInStadioCorrente(vehicleId) {
  const ultimo = await prisma.stageHistory.findFirst({ where: { vehicleId }, orderBy: { changedAt: "desc" } });
  if (!ultimo) return null;
  return Math.floor((Date.now() - new Date(ultimo.changedAt).getTime()) / (1000 * 60 * 60 * 24));
}

const veicoloRif = (v) => ({
  tipo: "veicolo",
  id: v.id,
  targa: v.targa,
  marca: v.marca,
  modello: v.modello,
  stage: v.stage,
  clienteId: v.client?.id ?? null,
  clienteNome: v.client ? `${v.client.nome} ${v.client.cognome}` : null,
  clienteTelefono: v.client?.telefono ?? null,
});

const preventivoRif = (q) => ({
  tipo: "preventivo",
  id: q.id,
  stato: q.stato,
  totale: Number(q.totale),
  vehicleId: q.vehicleId,
  veicoloLabel: q.vehicle ? `${q.vehicle.marca} ${q.vehicle.modello} (${q.vehicle.targa})` : null,
  clienteId: q.client?.id ?? null,
  clienteNome: q.client ? `${q.client.nome} ${q.client.cognome}` : null,
  clienteTelefono: q.client?.telefono ?? null,
});

const clienteRif = (c) => ({
  tipo: "cliente",
  id: c.id,
  clienteId: c.id,
  clienteNome: `${c.nome} ${c.cognome}`,
  clienteTelefono: c.telefono ?? null,
});

// Ogni strumento è di sola lettura e già filtrato sul tenant corrente:
// il Copilot non può creare, modificare o cancellare nulla, né vedere dati
// di un'altra carrozzeria. `raccogli` registra i record realmente
// consultati (chiave tipo:id) per costruire i "riferimenti" in risposta.
function creaStrumenti(tenantId, ruolo, raccogli) {
  return {
    riepilogo_dashboard: async () => {
      const [inOfficina, prontaConsegna, attesaRicambi, preventiviInviati, preventiviAccettati, quotesAccettati] =
        await Promise.all([
          prisma.vehicle.count({ where: { tenantId, NOT: { stage: "CONSEGNATA" } } }),
          prisma.vehicle.count({ where: { tenantId, stage: "PRONTA_CONSEGNA" } }),
          prisma.vehicle.count({ where: { tenantId, stage: "ORDINE_RICAMBI" } }),
          prisma.quote.count({ where: { tenantId, stato: "INVIATO" } }),
          prisma.quote.count({ where: { tenantId, stato: "ACCETTATO" } }),
          prisma.quote.findMany({ where: { tenantId, stato: "ACCETTATO" }, select: { totale: true } }),
        ]);
      const risultato = { inOfficina, prontaConsegna, attesaRicambi, preventiviInviati, preventiviAccettati };
      if (RUOLI_CON_ACCESSO_FINANZIARIO.has(ruolo)) {
        risultato.fatturatoStimato = quotesAccettati.reduce((sum, q) => sum + Number(q.totale), 0);
      }
      return risultato;
    },

    cerca_veicoli: async ({ ricerca, stage } = {}) => {
      const veicoli = await prisma.vehicle.findMany({
        where: {
          tenantId,
          ...(stage ? { stage } : {}),
          ...(ricerca
            ? { OR: [{ targa: { contains: ricerca, mode: "insensitive" } }, { marca: { contains: ricerca, mode: "insensitive" } }, { modello: { contains: ricerca, mode: "insensitive" } }, { vin: { contains: ricerca, mode: "insensitive" } }] }
            : {}),
        },
        include: { client: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
      });
      const righe = veicoli.map(veicoloRif);
      righe.forEach((r) => raccogli(r));
      return righe;
    },

    veicoli_a_rischio_ritardo: async () => {
      const ora = new Date();
      const veicoli = await prisma.vehicle.findMany({
        where: { tenantId, NOT: { stage: "CONSEGNATA" }, dataPrevistaConsegna: { not: null } },
        include: { client: true },
        orderBy: { dataPrevistaConsegna: "asc" },
        take: 20,
      });
      const risultato = [];
      for (const v of veicoli) {
        const scaduta = v.dataPrevistaConsegna < ora;
        const traDueGiorni = !scaduta && (v.dataPrevistaConsegna.getTime() - ora.getTime()) < 2 * 24 * 60 * 60 * 1000;
        if (!scaduta && !traDueGiorni) continue;
        const giorni = await giorniInStadioCorrente(v.id);
        const riga = {
          ...veicoloRif(v),
          dataPrevistaConsegna: v.dataPrevistaConsegna,
          motivo: scaduta ? "consegna prevista già superata" : "consegna prevista entro 48 ore",
          giorniInStadioCorrente: giorni,
        };
        raccogli(riga);
        risultato.push(riga);
      }
      return risultato;
    },

    veicoli_fermi_per_ricambi: async () => {
      const veicoli = await prisma.vehicle.findMany({
        where: { tenantId, stage: "ORDINE_RICAMBI" },
        include: { client: true },
        orderBy: { updatedAt: "asc" },
        take: 20,
      });
      const risultato = [];
      for (const v of veicoli) {
        const giorni = await giorniInStadioCorrente(v.id);
        const riga = { ...veicoloRif(v), giorniInStadioCorrente: giorni };
        raccogli(riga);
        risultato.push(riga);
      }
      return risultato;
    },

    consegne_settimana: async () => {
      const ora = new Date();
      const traUnaSettimana = new Date(ora.getTime() + 7 * 24 * 60 * 60 * 1000);
      const veicoli = await prisma.vehicle.findMany({
        where: { tenantId, NOT: { stage: "CONSEGNATA" }, dataPrevistaConsegna: { gte: ora, lte: traUnaSettimana } },
        include: { client: true },
        orderBy: { dataPrevistaConsegna: "asc" },
        take: 20,
      });
      const righe = veicoli.map((v) => ({ ...veicoloRif(v), dataPrevistaConsegna: v.dataPrevistaConsegna }));
      righe.forEach((r) => raccogli(r));
      return righe;
    },

    margine_veicolo: async ({ ricerca }) => {
      if (!ricerca) return { errore: "Specifica targa, marca o modello del veicolo." };
      const veicoli = await prisma.vehicle.findMany({
        where: {
          tenantId,
          OR: [
            { targa: { contains: ricerca, mode: "insensitive" } },
            { marca: { contains: ricerca, mode: "insensitive" } },
            { modello: { contains: ricerca, mode: "insensitive" } },
          ],
        },
        include: { client: true, quotes: { include: { items: true } } },
        take: 5,
      });
      if (veicoli.length === 0) return { errore: "Nessun veicolo trovato con questi criteri." };

      const risultato = [];
      for (const v of veicoli) {
        raccogli(veicoloRif(v));
        const preventivi = [];
        for (const q of v.quotes) {
          const margine = await calcolaMargineQuote(tenantId, q);
          preventivi.push({ preventivoId: q.id, stato: q.stato, totale: Number(q.totale), ...margine });
          raccogli({ ...preventivoRif({ ...q, vehicle: v, client: v.client }) });
        }
        risultato.push({ veicolo: `${v.marca} ${v.modello} (${v.targa})`, preventivi });
      }
      return risultato;
    },

    preventivi_marginalita_bassa: async ({ sogliaPercento = 20 } = {}) => {
      const quotes = await prisma.quote.findMany({
        where: { tenantId },
        include: { client: true, vehicle: true, items: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const risultato = [];
      for (const q of quotes) {
        const margine = await calcolaMargineQuote(tenantId, q);
        if (margine.marginePercento !== null && margine.marginePercento < sogliaPercento) {
          const riga = { ...preventivoRif(q), ...margine };
          raccogli(riga);
          risultato.push(riga);
          if (risultato.length >= 20) break;
        }
      }
      return risultato;
    },

    cerca_preventivi: async ({ stato, nonApprovati } = {}) => {
      const quotes = await prisma.quote.findMany({
        where: {
          tenantId,
          ...(stato ? { stato } : {}),
          ...(nonApprovati ? { stato: { in: ["BOZZA", "INVIATO"] } } : {}),
        },
        include: { client: true, vehicle: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const righe = quotes.map(preventivoRif);
      righe.forEach((r) => raccogli(r));
      return righe;
    },

    cerca_clienti: async ({ ricerca }) => {
      const clienti = await prisma.client.findMany({
        where: {
          tenantId,
          OR: [
            { nome: { contains: ricerca, mode: "insensitive" } },
            { cognome: { contains: ricerca, mode: "insensitive" } },
            { telefono: { contains: ricerca, mode: "insensitive" } },
          ],
        },
        include: { _count: { select: { vehicles: true } } },
        take: 20,
      });
      const righe = clienti.map((c) => ({ ...clienteRif(c), veicoli: c._count.vehicles }));
      righe.forEach((r) => raccogli(r));
      return righe;
    },

    disponibilita_tecnici_oggi: async () => {
      const inizioGiorno = new Date(); inizioGiorno.setHours(0, 0, 0, 0);
      const fineGiorno = new Date(); fineGiorno.setHours(23, 59, 59, 999);
      const tecnici = await prisma.user.findMany({ where: { tenantId, ruolo: "TECNICO", attivo: true } });
      const risultato = [];
      for (const t of tecnici) {
        const appuntamenti = await prisma.appointment.findMany({
          where: { tenantId, tecnicoId: t.id, inizio: { gte: inizioGiorno, lte: fineGiorno } },
          orderBy: { inizio: "asc" },
        });
        risultato.push({
          tecnico: `${t.nome} ${t.cognome}`,
          appuntamentiOggi: appuntamenti.map((a) => ({ titolo: a.titolo, inizio: a.inizio, fine: a.fine })),
          libero: appuntamenti.length === 0,
        });
      }
      return risultato;
    },

    fatturato_mensile: async () => {
      const seiMesiFa = new Date();
      seiMesiFa.setMonth(seiMesiFa.getMonth() - 6);
      const quotes = await prisma.quote.findMany({
        where: { tenantId, stato: "ACCETTATO", updatedAt: { gte: seiMesiFa } },
        select: { totale: true, updatedAt: true },
      });
      const perMese = {};
      for (const q of quotes) {
        const key = `${q.updatedAt.getFullYear()}-${String(q.updatedAt.getMonth() + 1).padStart(2, "0")}`;
        perMese[key] = (perMese[key] ?? 0) + Number(q.totale);
      }
      return Object.entries(perMese).sort(([a], [b]) => a.localeCompare(b)).map(([mese, totale]) => ({ mese, totale }));
    },

    tempi_lavorazione: async () => {
      const veicoli = await prisma.vehicle.findMany({
        where: { tenantId },
        select: { stageHistory: { orderBy: { changedAt: "asc" }, select: { toStage: true, changedAt: true } } },
      });
      const durate = {};
      for (const v of veicoli) {
        const h = v.stageHistory;
        for (let i = 0; i < h.length; i++) {
          const stage = h[i].toStage;
          const fine = h[i + 1] ? h[i + 1].changedAt : new Date();
          const ore = (fine - h[i].changedAt) / (1000 * 60 * 60);
          (durate[stage] ??= []).push(ore);
        }
      }
      return Object.entries(durate).map(([stage, valori]) => ({
        stage, giorniMedi: Number((valori.reduce((a, b) => a + b, 0) / valori.length / 24).toFixed(1)),
      }));
    },
  };
}

const STRUMENTI_ANTHROPIC = [
  { name: "riepilogo_dashboard", description: "Numeri chiave generali: veicoli in officina, pronta consegna, attesa ricambi, preventivi inviati/accettati, fatturato stimato.", input_schema: { type: "object", properties: {} } },
  { name: "cerca_veicoli", description: "Cerca veicoli per targa/marca/modello/VIN e/o filtra per stadio del workflow. Max 20 risultati, con dati cliente per contattarlo.", input_schema: { type: "object", properties: {
    ricerca: { type: "string" }, stage: { type: "string", description: "ACCETTAZIONE, PREVENTIVO, ATTESA_APPROVAZIONE, ORDINE_RICAMBI, IN_LAVORAZIONE, PREPARAZIONE, VERNICIATURA, LUCIDATURA, CONTROLLO_QUALITA, LAVAGGIO, PRONTA_CONSEGNA, CONSEGNATA" },
  } } },
  { name: "veicoli_a_rischio_ritardo", description: "Veicoli non ancora consegnati con data di consegna prevista già superata o entro le prossime 48 ore. Include da quanti giorni sono fermi nello stadio attuale.", input_schema: { type: "object", properties: {} } },
  { name: "veicoli_fermi_per_ricambi", description: "Veicoli attualmente nello stadio 'Ordine ricambi', con da quanti giorni sono fermi lì.", input_schema: { type: "object", properties: {} } },
  { name: "consegne_settimana", description: "Veicoli non ancora consegnati con data di consegna prevista nei prossimi 7 giorni.", input_schema: { type: "object", properties: {} } },
  { name: "margine_veicolo", description: "Margine stimato sui preventivi legati a un veicolo specifico (cerca per targa/marca/modello). Il margine sui ricambi è calcolato solo se il ricambio è tracciato a magazzino con lo stesso nome: se non trovato, la voce viene segnalata come costo non tracciato invece di essere stimata a caso.", input_schema: { type: "object", properties: { ricerca: { type: "string" } }, required: ["ricerca"] } },
  { name: "preventivi_marginalita_bassa", description: "Preventivi con marginalità stimata sotto una soglia percentuale (default 20%). Stessa logica di calcolo di margine_veicolo: segnala i preventivi con dati di costo incompleti.", input_schema: { type: "object", properties: { sogliaPercento: { type: "number" } } } },
  { name: "cerca_preventivi", description: "Cerca preventivi per stato, oppure con nonApprovati=true per quelli non ancora inviati/accettati (bozza o inviato).", input_schema: { type: "object", properties: {
    stato: { type: "string", description: "BOZZA, INVIATO, ACCETTATO, RIFIUTATO" }, nonApprovati: { type: "boolean" },
  } } },
  { name: "cerca_clienti", description: "Cerca clienti per nome, cognome o telefono. Max 20 risultati.", input_schema: { type: "object", properties: { ricerca: { type: "string" } }, required: ["ricerca"] } },
  { name: "disponibilita_tecnici_oggi", description: "Per ogni tecnico attivo, gli appuntamenti in calendario di oggi. 'libero' è true se non ha appuntamenti oggi (riflette solo il calendario appuntamenti, non i turni di lavoro).", input_schema: { type: "object", properties: {} } },
  { name: "fatturato_mensile", description: "Fatturato da preventivi accettati, raggruppato per mese, ultimi 6 mesi.", input_schema: { type: "object", properties: {} } },
  { name: "tempi_lavorazione", description: "Giorni medi trascorsi in ciascuno stadio del workflow (include il tempo medio di riparazione), dalla cronologia reale dei veicoli.", input_schema: { type: "object", properties: {} } },
];

function strumentiPerRuolo(ruolo) {
  if (RUOLI_CON_ACCESSO_FINANZIARIO.has(ruolo)) return STRUMENTI_ANTHROPIC;
  return STRUMENTI_ANTHROPIC.filter((s) => !STRUMENTI_FINANZIARI.has(s.name));
}

const SYSTEM_PROMPT_BASE = `Sei l'AI Copilot di Ombra CRM, un gestionale per carrozzerie. Rispondi in italiano, in modo diretto e concreto, come parleresti al titolare dell'officina.
Usa SEMPRE gli strumenti disponibili per recuperare i dati reali prima di rispondere: non inventare MAI numeri, nomi, targhe o stati. Se una domanda ne richiede più di uno, chiamali tutti prima di rispondere.
Se non trovi risultati, dillo chiaramente. Se un dato non è disponibile o non è tracciato nel gestionale (es. costo di un ricambio non a magazzino), dichiaralo esplicitamente invece di stimarlo.
Quando elenchi più elementi, usa un formato numerato breve con una spiegazione concisa per riga (motivo/stato/importo), e quando è utile aggiungi un suggerimento operativo pratico.
Se ti viene chiesto di compiere un'azione (cambiare uno stato, creare o modificare un record, inviare messaggi), spiega gentilmente che puoi solo rispondere a domande sui dati, non eseguire modifiche.`;

const SYSTEM_PROMPT_RESTRIZIONE_FINANZIARIA = `
Il ruolo di chi ti sta parlando non ha accesso ai dati finanziari (fatturato, margini). Non hai a disposizione strumenti per recuperarli: se te li chiedono, spiega gentilmente che questi dati sono visibili solo a chi ha un ruolo amministrativo, senza inventare o stimare cifre.`;

const chiediSchema = z.object({ domanda: z.string().min(1).max(500) });

// POST /api/copilot/chiedi
copilotRouter.post("/chiedi", async (req, res) => {
  const { tenantId } = tenantScope(req);

  const parsed = chiediSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Domanda mancante o troppo lunga." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurata su Railway." });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const limite = tenant.limiteAssistenteIAMensile ?? LIMITE_ASSISTENTE_DEFAULT[tenant.piano] ?? 0;
  const usate = await contaDomandeQuestoMese(tenantId);
  if (usate >= limite) {
    return res.status(429).json({
      error: `Hai raggiunto il limite di ${limite} domande incluse nel tuo piano questo mese (${usate} usate). Contattaci per un upgrade del piano.`,
    });
  }

  const riferimentiMap = new Map();
  const raccogli = (rif) => { if (rif?.tipo && rif?.id) riferimentiMap.set(`${rif.tipo}:${rif.id}`, rif); };

  const strumenti = creaStrumenti(tenantId, req.auth.role, raccogli);
  const strumentiDisponibili = strumentiPerRuolo(req.auth.role);
  const systemPrompt = RUOLI_CON_ACCESSO_FINANZIARIO.has(req.auth.role)
    ? SYSTEM_PROMPT_BASE
    : SYSTEM_PROMPT_BASE + SYSTEM_PROMPT_RESTRIZIONE_FINANZIARIA;
  const messages = [{ role: "user", content: parsed.data.domanda }];

  try {
    for (let iterazione = 0; iterazione < 5; iterazione++) {
      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 1200,
          system: systemPrompt,
          tools: strumentiDisponibili,
          messages,
        }),
      });
      const data = await apiRes.json();
      if (!apiRes.ok) {
        console.error("Errore Anthropic API (copilot):", data);
        return res.status(502).json({ error: "Errore nella chiamata al servizio IA. Controlla la chiave ANTHROPIC_API_KEY su Railway." });
      }

      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") {
        const testo = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        await prisma.aiAssistantLog.create({ data: { tenantId, domanda: parsed.data.domanda.slice(0, 300) } });
        return res.json({
          risposta: testo || "Non sono riuscito a formulare una risposta, riprova.",
          riferimenti: Array.from(riferimentiMap.values()).slice(0, 8),
        });
      }

      const toolResults = [];
      for (const block of data.content) {
        if (block.type !== "tool_use") continue;
        const fn = strumenti[block.name];
        let risultato;
        try {
          risultato = fn ? await fn(block.input || {}) : { errore: "Strumento sconosciuto" };
        } catch (e) {
          console.error(`Errore strumento copilot ${block.name}:`, e);
          risultato = { errore: "Errore nel recuperare questi dati." };
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(risultato) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return res.status(502).json({ error: "Il Copilot ha impiegato troppi passaggi per rispondere. Prova a riformulare la domanda." });
  } catch (e) {
    console.error("Errore Copilot IA:", e);
    return res.status(502).json({ error: "Impossibile completare la richiesta. Riprova." });
  }
});

// GET /api/copilot/utilizzo
copilotRouter.get("/utilizzo", async (req, res) => {
  const { tenantId } = tenantScope(req);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const limite = tenant.limiteAssistenteIAMensile ?? LIMITE_ASSISTENTE_DEFAULT[tenant.piano] ?? 0;
  const usate = await contaDomandeQuestoMese(tenantId);
  res.json({ usate, limite, piano: tenant.piano });
});
