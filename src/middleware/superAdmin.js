import jwt from "jsonwebtoken";

// Deliberatamente separato da middleware/auth.js: un token super-admin
// non ha (e non deve mai avere) un tenantId — verifica qui che il
// claim superAdmin sia presente, mai riusare requireAuth per questo
// scopo (vedi il controllo esplicito lì che rifiuta un token senza
// tenantId, proprio per impedire lo scambio nell'altro verso).
export function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token mancante" });
  }
  try {
    const payload = jwt.verify(header.slice("Bearer ".length), process.env.JWT_SECRET);
    if (!payload.superAdmin || !payload.sub) {
      return res.status(401).json({ error: "Token non valido per questo contesto" });
    }
    req.superAdmin = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Token non valido o scaduto" });
  }
}
