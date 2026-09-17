import { prisma } from "./prisma.js";

// Punto 41 (cost control AI): prezzi ufficiali Anthropic per milione di
// token, verificati su platform.claude.com/docs/en/about-claude/pricing
// il 2026-09-17. Aggiornare qui se Anthropic cambia i prezzi — mai
// ricalcolare i costi già registrati (vedi commento su costoStimatoUsd
// in schema.prisma).
const PREZZI_PER_MILIONE_USD = {
  "claude-sonnet-5": { input: 2, output: 10 },
};

// Se il modello non è nel listino sopra, non stimiamo un costo a caso:
// meglio nessuna riga che una riga con un numero inventato.
export function calcolaCostoUsd(model, tokenInput, tokenOutput) {
  const prezzi = PREZZI_PER_MILIONE_USD[model];
  if (!prezzi) return null;
  return ((tokenInput || 0) * prezzi.input + (tokenOutput || 0) * prezzi.output) / 1_000_000;
}

// Una riga per OGNI chiamata reale all'API Anthropic, non per "azione
// utente": il loop di tool-use di Assistente/Copilot può fare più
// chiamate per una singola domanda, ciascuna fatturata a parte da
// Anthropic. usage è la risposta `usage` dell'API Messages
// ({input_tokens, output_tokens}) — se assente (risposta d'errore),
// non registriamo nulla.
export async function registraCostoAi({ tenantId, funzione, model, usage }) {
  if (!usage) return;
  const tokenInput = usage.input_tokens ?? null;
  const tokenOutput = usage.output_tokens ?? null;
  const costo = calcolaCostoUsd(model, tokenInput, tokenOutput);
  if (costo == null) return;
  await prisma.aiCostLog.create({
    data: { tenantId, funzione, provider: "anthropic", model, tokenInput, tokenOutput, costoStimatoUsd: costo },
  }).catch((err) => console.error(`[ai-cost] Log costo fallito per tenant ${tenantId} (${funzione}):`, err.message));
}
