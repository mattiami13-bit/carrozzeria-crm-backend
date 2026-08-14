import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, tenantScope } from "../middleware/auth.js";

export const assistenteRouter = Router();
assistenteRouter.use(requireAuth);

// -----------------------------
// Limiti mensili (separati da quelli delle analisi foto danni, Fase 7)
// -----------------------------
const LIMITE_ASSISTENTE_DEFAULT = {
  TRIAL: 20,
  STARTER: 100,
  PROFESSIONAL: 500,
  ENTERPRISE: 2000,
};

async function contaDomandeQuestoMese(tenantId) {
  const inizioMese = new Date();
  inizioMese.setDate(1);
  inizioMese.setHours(0, 0, 0, 0);
  return prisma.aiAssistantLog.count({ where: { tenantId, createdAt: { gte: inizioMese } } });
}

// -----------------------------
// "Strumenti" che il modello può usare per leggere i dati reali del
// tenant. Sono TUTTI di sola lettura: l'assistente non può creare,
// modificare o cancellare nulla. Ogni funzione è già scope-ata sul
// tenant corrente, quindi il modello non può in alcun modo vedere dati
// di un'altra carrozzeria.
// -----------------------------
function creaStrumenti(tenantId, ruolo) {
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
      // Il fatturato è un dato finanziario: lo includiamo solo se il ruolo
      // di chi ha fatto la domanda è autorizzato a vederlo.
      if (RUOLI_CON_ACCESSO_FINANZIARIO.has(ruolo)) {
        risultato.fatturatoStimato = quotesAccettati.reduce((sum, q) => sum + Number(q.totale), 0);
      }
      return risultato;
    },

    conta_veicoli_per_stage: async () => {
      const veicoli = await prisma.vehicle.groupBy({ by: ["stage"], where: { tenantId }, _count: true });
      return veicoli.map((v) => ({ stage: v.stage, count: v._count }));
    },

    cerca_veicoli: async ({ ricerca, stage } = {}) => {
      const veicoli = await prisma.vehicle.findMany({
        where: {
          tenantId,
          ...(stage ? { stage } : {}),
          ...(ricerca
            ? { OR: [{ targa: { contains: ricerca, mode: "insensitive" } }, { vin: { contains: ricerca, mode: "insensitive" } }] }
            : {}),
        },
        include: { client: { select: { nome: true, cognome: true } } },
        orderBy: { updatedAt: "desc" },
        take: 20,
      });
      return veicoli.map((v) => ({
        targa: v.targa, marca: v.marca, modello: v.modello, stage: v.stage,
        cliente: v.client ? `${v.client.nome} ${v.client.cognome}` : null,
      }));
    },

    cerca_preventivi: async ({ stato } = {}) => {
      const preventivi = await prisma.quote.findMany({
        where: { tenantId, ...(stato ? { stato } : {}) },
        include: { client: { select: { nome: true, cognome: true } }, vehicle: { select: { targa: true, marca: true, modello: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return preventivi.map((p) => ({
        cliente: `${p.client.nome} ${p.client.cognome}`,
        veicolo: `${p.vehicle.marca} ${p.vehicle.modello} (${p.vehicle.targa})`,
        totale: Number(p.totale), stato: p.stato,
      }));
    },

    cerca_sinistri: async ({ stato, clienteNome } = {}) => {
      const sinistri = await prisma.sinistro.findMany({
        where: {
          tenantId,
          ...(stato ? { stato } : {}),
          ...(clienteNome
            ? { client: { OR: [{ nome: { contains: clienteNome, mode: "insensitive" } }, { cognome: { contains: clienteNome, mode: "insensitive" } }] } }
            : {}),
        },
        include: { client: { select: { nome: true, cognome: true } }, vehicle: { select: { targa: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return sinistri.map((s) => ({
        numeroPratica: s.numeroPratica, cliente: `${s.client.nome} ${s.client.cognome}`,
        veicolo: s.vehicle?.targa || null, compagnia: s.compagniaAssicurativa, stato: s.stato,
        importoTotale: s.importoTotale ? Number(s.importoTotale) : null,
        residuo: s.importoTotale != null
          ? Number(s.importoTotale) - Number(s.pagatoAssicurazione || 0) - Number(s.pagatoCliente || 0)
          : null,
      }));
    },

    cerca_clienti: async ({ ricerca }) => {
      const clienti = await prisma.client.findMany({
        where: { tenantId, OR: [
          { nome: { contains: ricerca, mode: "insensitive" } },
          { cognome: { contains: ricerca, mode: "insensitive" } },
          { telefono: { contains: ricerca, mode: "insensitive" } },
        ] },
        include: { _count: { select: { vehicles: true } } },
        take: 20,
      });
      return clienti.map((c) => ({ nome: c.nome, cognome: c.cognome, telefono: c.telefono, email: c.email, veicoli: c._count.vehicles }));
    },

    fatturato_mensile: async () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const quotes = await prisma.quote.findMany({
        where: { tenantId, stato: "ACCETTATO", updatedAt: { gte: sixMonthsAgo } },
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
      const vehicles = await prisma.vehicle.findMany({
        where: { tenantId },
        select: { stageHistory: { orderBy: { changedAt: "asc" }, select: { toStage: true, changedAt: true } } },
      });
      const durate = {};
      for (const v of vehicles) {
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

    margini_ricambi: async () => {
      const parts = await prisma.part.findMany({
        where: { tenantId },
        select: { codice: true, descrizione: true, prezzoAcquisto: true, prezzoVendita: true, movements: { where: { tipo: "SCARICO" }, select: { quantita: true } } },
      });
      const dettaglio = parts
        .filter((p) => p.prezzoVendita != null)
        .map((p) => {
          const q = p.movements.reduce((sum, m) => sum + m.quantita, 0);
          const margineUnitario = Number(p.prezzoVendita) - Number(p.prezzoAcquisto);
          return { codice: p.codice, descrizione: p.descrizione, quantitaVenduta: q, margineTotale: margineUnitario * q };
        })
        .filter((p) => p.quantitaVenduta > 0)
        .sort((a, b) => b.margineTotale - a.margineTotale)
        .slice(0, 10);
      return { margineComplessivo: dettaglio.reduce((s, p) => s + p.margineTotale, 0), dettaglio };
    },

    appuntamenti_prossimi: async ({ giorni = 7 } = {}) => {
      const ora = new Date();
      const limite = new Date();
      limite.setDate(limite.getDate() + giorni);
      const appuntamenti = await prisma.appointment.findMany({
        where: { tenantId, inizio: { gte: ora, lte: limite } },
        include: { client: { select: { nome: true, cognome: true } } },
        orderBy: { inizio: "asc" },
        take: 20,
      });
      return appuntamenti.map((a) => ({
        titolo: a.titolo, inizio: a.inizio, fine: a.fine,
        cliente: a.client ? `${a.client.nome} ${a.client.cognome}` : null, tipo: a.tipo,
      }));
    },
  };
}

const STRUMENTI_ANTHROPIC = [
  { name: "riepilogo_dashboard", description: "Numeri chiave generali: veicoli in officina, pronta consegna, attesa ricambi, preventivi inviati/accettati, fatturato stimato.", input_schema: { type: "object", properties: {} } },
  { name: "conta_veicoli_per_stage", description: "Quanti veicoli ci sono in ciascuno stadio del workflow (accettazione, verniciatura, lavaggio, ecc.)", input_schema: { type: "object", properties: {} } },
  { name: "cerca_veicoli", description: "Cerca veicoli per targa/VIN e/o filtra per stadio del workflow. Max 20 risultati.", input_schema: { type: "object", properties: {
    ricerca: { type: "string", description: "Testo da cercare in targa o VIN" },
    stage: { type: "string", description: "ACCETTAZIONE, PREVENTIVO, ATTESA_APPROVAZIONE, ORDINE_RICAMBI, IN_LAVORAZIONE, PREPARAZIONE, VERNICIATURA, LUCIDATURA, CONTROLLO_QUALITA, LAVAGGIO, PRONTA_CONSEGNA, CONSEGNATA" },
  } } },
  { name: "cerca_preventivi", description: "Cerca preventivi per stato. Max 20 risultati.", input_schema: { type: "object", properties: {
    stato: { type: "string", description: "BOZZA, INVIATO, ACCETTATO, RIFIUTATO" },
  } } },
  { name: "cerca_sinistri", description: "Cerca sinistri per stato e/o nome cliente. Include importi e residuo da incassare. Max 20 risultati.", input_schema: { type: "object", properties: {
    stato: { type: "string", description: "APERTO, INVIATO_ASSICURAZIONE, PERIZIA_FISSATA, PERIZIA_COMPLETATA, APPROVATO, LAVORAZIONE, COMPLETATO, LIQUIDATO" },
    clienteNome: { type: "string" },
  } } },
  { name: "cerca_clienti", description: "Cerca clienti per nome, cognome o telefono. Max 20 risultati.", input_schema: { type: "object", properties: { ricerca: { type: "string" } }, required: ["ricerca"] } },
  { name: "fatturato_mensile", description: "Fatturato da preventivi accettati, raggruppato per mese, ultimi 6 mesi.", input_schema: { type: "object", properties: {} } },
  { name: "tempi_lavorazione", description: "Giorni medi trascorsi in ciascuno stadio del workflow, dalla cronologia reale dei veicoli.", input_schema: { type: "object", properties: {} } },
  { name: "margini_ricambi", description: "Margine totale stimato sui ricambi venduti e classifica dei più redditizi.", input_schema: { type: "object", properties: {} } },
  { name: "appuntamenti_prossimi", description: "Appuntamenti in calendario nei prossimi N giorni (default 7).", input_schema: { type: "object", properties: { giorni: { type: "number" } } } },
];

const STRUMENTI_FINANZIARI = new Set(["fatturato_mensile", "margini_ricambi"]);
const RUOLI_CON_ACCESSO_FINANZIARIO = new Set(["ADMIN", "AMMINISTRAZIONE"]);

// Filtra gli strumenti disponibili in base al ruolo di chi fa la domanda:
// TECNICO e ACCETTATORE non vedono fatturato e margini, per coerenza con
// le stesse restrizioni già applicate alla dashboard. "riepilogo_dashboard"
// resta disponibile a tutti ma viene "ripulito" del fatturato in
// creaStrumenti quando il ruolo non è autorizzato.
function strumentiPerRuolo(ruolo) {
  if (RUOLI_CON_ACCESSO_FINANZIARIO.has(ruolo)) return STRUMENTI_ANTHROPIC;
  return STRUMENTI_ANTHROPIC.filter((s) => !STRUMENTI_FINANZIARI.has(s.name));
}

const SYSTEM_PROMPT_BASE = `Sei l'assistente dati di Ombra CRM, un gestionale per carrozzerie. Rispondi in italiano, in modo diretto e conciso.
Usa SEMPRE gli strumenti disponibili per recuperare i dati reali prima di rispondere: non inventare mai numeri, nomi o stati.
Se una domanda richiede più strumenti (es. confrontare due cose), chiamali entrambi prima di rispondere.
Se ti viene chiesto di compiere un'azione (cambiare uno stato, creare o modificare un record, inviare messaggi), spiega gentilmente che al momento puoi solo rispondere a domande sui dati, non eseguire modifiche.
Se non trovi risultati per una ricerca, dillo chiaramente invece di inventare.
Rispondi in modo colloquiale, come faresti parlando con il titolare dell'officina — evita elenchi puntati per risposte brevi.`;

const SYSTEM_PROMPT_RESTRIZIONE_FINANZIARIA = `
Il ruolo di chi ti sta parlando non ha accesso ai dati finanziari (fatturato, margini). Non hai a disposizione strumenti per recuperarli: se te li chiedono, spiega gentilmente che questi dati sono visibili solo a chi ha un ruolo amministrativo, senza inventare o stimare cifre.`;

const chiediSchema = z.object({ domanda: z.string().min(1).max(500) });

// POST /api/assistente/chiedi
assistenteRouter.post("/chiedi", async (req, res) => {
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

  const strumenti = creaStrumenti(tenantId, req.auth.role);
  const strumentiDisponibili = strumentiPerRuolo(req.auth.role);
  const systemPrompt = RUOLI_CON_ACCESSO_FINANZIARIO.has(req.auth.role)
    ? SYSTEM_PROMPT_BASE
    : SYSTEM_PROMPT_BASE + SYSTEM_PROMPT_RESTRIZIONE_FINANZIARIA;
  const messages = [{ role: "user", content: parsed.data.domanda }];

  try {
    // Loop di tool-use: al massimo 5 andate e ritorni, per evitare cicli infiniti.
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
          max_tokens: 1024,
          system: systemPrompt,
          tools: strumentiDisponibili,
          messages,
        }),
      });
      const data = await apiRes.json();
      if (!apiRes.ok) {
        console.error("Errore Anthropic API (assistente):", data);
        return res.status(502).json({ error: "Errore nella chiamata al servizio IA. Controlla la chiave ANTHROPIC_API_KEY su Railway." });
      }

      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") {
        const testo = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        await prisma.aiAssistantLog.create({ data: { tenantId, domanda: parsed.data.domanda.slice(0, 300) } });
        return res.json({ risposta: testo || "Non sono riuscito a formulare una risposta, riprova." });
      }

      // Esegue tutte le chiamate agli strumenti richieste in questo turno.
      const toolResults = [];
      for (const block of data.content) {
        if (block.type !== "tool_use") continue;
        const fn = strumenti[block.name];
        let risultato;
        try {
          risultato = fn ? await fn(block.input || {}) : { errore: "Strumento sconosciuto" };
        } catch (e) {
          console.error(`Errore strumento ${block.name}:`, e);
          risultato = { errore: "Errore nel recuperare questi dati." };
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(risultato) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return res.status(502).json({ error: "L'assistente ha impiegato troppi passaggi per rispondere. Prova a riformulare la domanda." });
  } catch (e) {
    console.error("Errore assistente IA:", e);
    return res.status(502).json({ error: "Impossibile completare la richiesta. Riprova." });
  }
});

// GET /api/assistente/utilizzo — quante domande usate questo mese, per il widget in dashboard/pannello.
assistenteRouter.get("/utilizzo", async (req, res) => {
  const { tenantId } = tenantScope(req);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const limite = tenant.limiteAssistenteIAMensile ?? LIMITE_ASSISTENTE_DEFAULT[tenant.piano] ?? 0;
  const usate = await contaDomandeQuestoMese(tenantId);
  res.json({ usate, limite, piano: tenant.piano });
});
