import rateLimit from "express-rate-limit";

// Limiti per gli endpoint di autenticazione più sensibili al brute-force
// e all'email-bombing. Chiave per IP (default di express-rate-limit).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppi tentativi di accesso. Riprova tra qualche minuto." },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste di registrazione da questo indirizzo. Riprova più tardi." },
});

export const emailActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste. Riprova tra qualche minuto." },
});
