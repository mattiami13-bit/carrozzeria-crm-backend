// Modalità Tecnico: calcolo ore reali e KPI. Funzioni pure, testabili senza
// database — la stessa idea già usata in delay.js/profit.js.

// Somma la durata (in ore) dei segmenti di una lavorazione. I segmenti
// chiusi (fine valorizzata) contano sempre; quello eventualmente aperto
// conta solo se richiesto esplicitamente (es. per mostrare il tempo che
// sta scorrendo in tempo reale), usando `ora` come riferimento.
export function oreReali(timeEntries, { includiInCorso = false, ora = new Date() } = {}) {
  return timeEntries.reduce((tot, e) => {
    const fine = e.fine ? new Date(e.fine) : includiInCorso ? ora : null;
    if (!fine) return tot;
    const ms = fine - new Date(e.inizio);
    return tot + Math.max(0, ms / 3_600_000);
  }, 0);
}

// Scostamento ore previste/reali: numero neutro (differenza), mai un
// punteggio o un giudizio. La lettura ("in linea", "sopra", "sotto") resta
// descrittiva, non un voto sul tecnico.
export function scostamento(oreStimate, oreReali) {
  return Number(oreReali) - Number(oreStimate);
}

// Aggrega più lavorazioni per una chiave (tecnico o reparto). Nessuna
// metrica punitiva: solo somme e medie, senza soglie di "buono/cattivo".
export function aggregaKpi(workOrders, keyFn, labelFn) {
  const groups = new Map();
  for (const wo of workOrders) {
    const key = keyFn(wo);
    if (!groups.has(key)) {
      groups.set(key, { key, label: labelFn(wo), lavorazioni: 0, completate: 0, oreStimateTot: 0, oreRealiTot: 0 });
    }
    const g = groups.get(key);
    const reali = oreReali(wo.timeEntries || []);
    g.lavorazioni++;
    if (wo.stato === "COMPLETATA") g.completate++;
    g.oreStimateTot += Number(wo.oreStimate);
    g.oreRealiTot += reali;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    scostamentoTot: Number((g.oreRealiTot - g.oreStimateTot).toFixed(2)),
    oreStimateTot: Number(g.oreStimateTot.toFixed(2)),
    oreRealiTot: Number(g.oreRealiTot.toFixed(2)),
  }));
}

export const REPARTI = ["CARROZZERIA", "MECCANICA", "VERNICIATURA", "FINITURA"];
