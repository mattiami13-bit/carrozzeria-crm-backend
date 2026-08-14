import { prisma } from "../lib/prisma.js";

// Registra automaticamente ogni azione che modifica dati (POST/PATCH/
// PUT/DELETE) e ogni tentativo respinto per permessi insufficienti (403)
// o autenticazione mancante/non valida (401). Le GET non vengono
// registrate: sarebbero troppo rumorose e non servono per capire "chi ha
// cambiato cosa".
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
    const daTracciare = metodiDaTracciare.includes(req.method) || res.statusCode === 401 || res.statusCode === 403;
    if (!daTracciare) return;

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
        },
      })
      .catch((e) => console.error("Errore scrittura audit log:", e));
  });

  next();
}
