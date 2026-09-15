// Punto 24 (monitoring, "API latency"): oggi nessuna richiesta registra
// quanto ha impiegato. Non logga OGNI richiesta (troppo rumoroso e poco
// utile: le GET veloci non dicono nulla di interessante) — segnala solo
// le richieste "lente", la categoria che davvero serve per accorgersi di
// un problema di performance prima che diventi un reclamo di un cliente.
const SOGLIA_LENTA_MS = 2000;

export function latencyLogger(req, res, next) {
  const inizio = process.hrtime.bigint();
  res.on("finish", () => {
    const durataMs = Number(process.hrtime.bigint() - inizio) / 1e6;
    if (durataMs < SOGLIA_LENTA_MS) return;
    console.warn(JSON.stringify({
      livello: "warn",
      tipo: "richiesta_lenta",
      timestamp: new Date().toISOString(),
      metodo: req.method,
      percorso: req.originalUrl,
      statusCode: res.statusCode,
      durataMs: Math.round(durataMs),
      tenantId: req.auth?.tenantId ?? null,
    }));
  });
  next();
}
