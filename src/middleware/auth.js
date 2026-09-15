import jwt from "jsonwebtoken";

// Verifica il JWT e mette a disposizione delle route successive
// req.auth = { userId, tenantId, role }.
//
// tenantId viene letto SOLO dal token firmato dal server, mai da un
// parametro/header passato dal client: è la barriera principale che
// impedisce a un utente della carrozzeria A di leggere i dati della B.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token mancante" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token non valido o scaduto" });
  }
}

// Come requireAuth ma non blocca mai la richiesta: restituisce tenantId
// se il Bearer token è presente e valido, altrimenti null. Usata dal
// controllo abbonamento (che deve "vedere" il tenantId quando c'è, ma
// lasciare che sia requireAuth — più a valle nella stessa rotta — a
// gestire un token mancante/non valido con il consueto 401).
export function tenantIdOpzionale(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice("Bearer ".length), process.env.JWT_SECRET).tenantId || null;
  } catch {
    return null;
  }
}

// Da usare dopo requireAuth per limitare una route a determinati ruoli.
// Esempio: requireRole("ADMIN", "AMMINISTRAZIONE")
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Permessi insufficienti" });
    }
    next();
  };
}

// Helper per iniettare automaticamente tenantId nelle query Prisma:
// evita di dimenticarselo in qualche route e creare data leak tra tenant.
export function tenantScope(req) {
  return { tenantId: req.auth.tenantId };
}
