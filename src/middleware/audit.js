import { prisma } from "../lib/prisma.js";

// Mappa "METODO percorso" (percorso con :placeholder al posto degli id
// reali) -> { azione, metodiExtra?, campi? }. Serve a tradurre l'accesso
// HTTP grezzo in un'etichetta leggibile per il punto 21 del prompt SaaS
// ("registra: login, logout, password modificata, utente invitato...").
//
// "campi" è un elenco ESPLICITO di nomi di campo sicuri da estrarre da
// req.body per questa singola rotta — MAI un dump di req.body intero,
// per costruzione: così una rotta che in futuro aggiunge un campo
// sensibile non finisce mai nell'audit log per errore.
const AZIONI = {
  "POST /api/auth/login": { azione: "login", campi: ["email"] },
  "POST /api/auth/register": { azione: "registrazione tenant", campi: ["email", "ragioneSociale"] },
  "GET /api/auth/verifica-email": { azione: "email verificata", tracciaSempre: true },
  "POST /api/auth/reinvia-verifica-email": { azione: "richiesta reinvio verifica email", campi: ["email"] },
  "POST /api/auth/reinvia-verifica": { azione: "richiesta reinvio verifica email" },
  "POST /api/auth/password-dimenticata": { azione: "richiesta reset password", campi: ["email"] },
  "POST /api/auth/reset-password": { azione: "password reimpostata" },
  "POST /api/auth/cambia-password": { azione: "password modificata" },
  "POST /api/users": { azione: "utente invitato", campi: ["email", "ruolo"] },
  "PATCH /api/vehicles/:id/stage": { azione: "cambio stato pratica", campi: ["stage"] },
  "PATCH /api/quotes/:id/stato": { azione: "preventivo modificato", campi: ["stato"] },
  "GET /api/gdpr/export": { azione: "export dati tenant", tracciaSempre: true },
  "GET /api/clients/:id/export": { azione: "export dati cliente", tracciaSempre: true },
  "POST /api/clients/:id/richiesta-cancellazione": { azione: "richiesta cancellazione cliente (GDPR)" },
  "POST /api/gdpr/richiesta-cancellazione-account": { azione: "richiesta cancellazione account (GDPR)" },
  "POST /api/billing/checkout": { azione: "avvio checkout abbonamento", campi: ["piano", "periodicita"] },
  "POST /api/billing/portal": { azione: "accesso portale fatturazione" },
  "PUT /api/whatsapp/templates/:id": { azione: "config modificata (template WhatsApp)", campi: ["attivo"] },
};

// Sostituisce ogni segmento che assomiglia a un id (cuid/uuid/numero) con
// ":id", per far corrispondere "/api/quotes/abc123/stato" alla chiave
// "PATCH /api/quotes/:id/stato" della mappa sopra.
function normalizzaPercorso(percorso) {
  return percorso
    .split("?")[0]
    .split("/")
    .map((seg) => (/^[a-z0-9]{20,}$/i.test(seg) || /^\d+$/.test(seg) || /^[A-Z][A-Z_]{2,}$/.test(seg) ? ":id" : seg))
    .join("/");
}

// Registra automaticamente ogni azione che modifica dati (POST/PATCH/
// PUT/DELETE) e ogni tentativo respinto per permessi insufficienti (403)
// o autenticazione mancante/non valida (401), più le poche GET
// semanticamente rilevanti elencate sopra (export, verifica email).
//
// Funziona "ad ascolto": si aggancia all'evento "finish" della risposta,
// che scatta quando la risposta è stata inviata per intero. A quel punto
// req.auth (se il token era valido) è già stato popolato da requireAuth
// più a valle nella catena, quindi qui possiamo leggerlo in sicurezza.
//
// Va montato PRIMA di tutte le route (subito dopo express.json()), così
// intercetta ogni richiesta dell'applicazione con una sola riga in index.js.
export function auditLogger(req, res, next) {
  const metodiDaTracciare = ["POST", "PATCH", "PUT", "DELETE"];

  res.on("finish", () => {
    const chiave = `${req.method} ${normalizzaPercorso(req.originalUrl)}`;
    const regola = AZIONI[chiave];

    const daTracciare =
      metodiDaTracciare.includes(req.method) ||
      res.statusCode === 401 ||
      res.statusCode === 403 ||
      regola?.tracciaSempre;
    if (!daTracciare) return;

    // Solo per risposte riuscite ha senso registrare i campi della
    // richiesta: un tentativo fallito (400/401/403/...) non ha davvero
    // "cambiato" nulla, meglio non arricchirlo con dati potenzialmente
    // fuorvianti.
    let metadata;
    if (regola?.campi && res.statusCode < 400) {
      metadata = {};
      for (const campo of regola.campi) {
        if (req.body?.[campo] !== undefined) metadata[campo] = req.body[campo];
      }
      if (Object.keys(metadata).length === 0) metadata = undefined;
    }

    // Scritture "fire and forget": un log fallito non deve mai bloccare
    // o rallentare la risposta già inviata all'utente.
    prisma.auditLog
      .create({
        data: {
          tenantId: req.auth?.tenantId || null,
          userId: req.auth?.userId || null,
          metodo: req.method,
          percorso: req.originalUrl,
          statusCode: res.statusCode,
          azione: regola?.azione || null,
          risorsaId: /^[a-z0-9]{20,}$/i.test(req.params?.id || "") ? req.params.id : null,
          ip: req.ip || null,
          metadata,
        },
      })
      .catch((e) => console.error("Errore scrittura audit log:", e));
  });

  next();
}
