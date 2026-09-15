import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { inviaEmailBenvenuto, inviaEmailVerifica, inviaEmailResetPassword } from "../lib/email.js";
import { creaNotificaUtente } from "../lib/notificheInApp.js";

export const authRouter = Router();

const VERIFICA_EMAIL_VALIDITA_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_VALIDITA_MS = 60 * 60 * 1000;

function generaToken() {
  return crypto.randomBytes(32).toString("hex");
}

const registerSchema = z.object({
  ragioneSociale: z.string().min(2),
  partitaIva: z.string().optional(),
  nomeAdmin: z.string().min(1),
  cognomeAdmin: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// Crea un nuovo tenant (carrozzeria) con il suo utente ADMIN e avvia
// automaticamente la prova gratuita di 30 giorni.
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { ragioneSociale, partitaIva, nomeAdmin, cognomeAdmin, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email già registrata" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const emailVerificaToken = generaToken();
  const emailVerificaScadenza = new Date(Date.now() + VERIFICA_EMAIL_VALIDITA_MS);

  const tenant = await prisma.tenant.create({
    data: {
      ragioneSociale,
      partitaIva,
      trialEndsAt,
      users: {
        create: {
          nome: nomeAdmin,
          cognome: cognomeAdmin,
          email,
          passwordHash,
          ruolo: "ADMIN",
          emailVerificaToken,
          emailVerificaScadenza,
        },
      },
    },
    include: { users: true },
  });

  const admin = tenant.users[0];
  const token = signToken(admin, tenant.id);

  // L'email di benvenuto è "best effort": un problema del provider email
  // non deve mai impedire la creazione dell'account.
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const verificaUrl = `${baseUrl}/verifica-email/?token=${emailVerificaToken}`;
  inviaEmailBenvenuto({ email, nome: nomeAdmin, ragioneSociale, verificaUrl }).catch((err) =>
    console.error("[auth] Errore invio email di benvenuto:", err.message)
  );

  res.status(201).json({
    token,
    tenant: { id: tenant.id, ragioneSociale: tenant.ragioneSociale },
    user: { id: admin.id, nome: admin.nome, cognome: admin.cognome, ruolo: admin.ruolo, emailVerificata: false },
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.attivo) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }

  // Il controllo password viene prima di questo, così un tentativo con
  // password sbagliata non rivela mai se l'account esiste ed è solo da
  // verificare: resta un generico "Credenziali non valide".
  if (!user.emailVerificata) {
    return res.status(403).json({
      error: "Email non verificata. Controlla la tua casella di posta o richiedi un nuovo link di verifica.",
      emailNonVerificata: true,
    });
  }

  const token = signToken(user, user.tenantId);
  res.json({
    token,
    user: { id: user.id, nome: user.nome, cognome: user.cognome, ruolo: user.ruolo, emailVerificata: user.emailVerificata },
  });
});

const verificaEmailSchema = z.object({ token: z.string().min(1) });

// GET cliccabile direttamente dal link nell'email: consuma il token e
// marca l'account come verificato. Idempotente lato utente (un secondo
// click su un link già usato restituisce semplicemente "token non valido").
authRouter.get("/verifica-email", async (req, res) => {
  const parsed = verificaEmailSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Token mancante" });

  const user = await prisma.user.findUnique({ where: { emailVerificaToken: parsed.data.token } });
  if (!user || !user.emailVerificaScadenza || user.emailVerificaScadenza < new Date()) {
    return res.status(400).json({ error: "Link di verifica non valido o scaduto" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificata: true, emailVerificaToken: null, emailVerificaScadenza: null },
  });

  res.json({ ok: true });
});

async function rigeneraEInviaVerifica(user, req) {
  const emailVerificaToken = generaToken();
  const emailVerificaScadenza = new Date(Date.now() + VERIFICA_EMAIL_VALIDITA_MS);
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificaToken, emailVerificaScadenza },
  });

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const verificaUrl = `${baseUrl}/verifica-email/?token=${emailVerificaToken}`;
  return inviaEmailVerifica({ email: user.email, nome: user.nome, verificaUrl });
}

// Permette di richiedere una nuova email di verifica se la precedente è
// scaduta o non è mai arrivata (richiede login: usata da un utente già
// autenticato ma non ancora verificato in un contesto interno).
authRouter.post("/reinvia-verifica", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) return res.status(404).json({ error: "Utente non trovato" });
  if (user.emailVerificata) return res.json({ ok: true, giaVerificata: true });

  const esito = await rigeneraEInviaVerifica(user, req);
  res.json({ ok: esito.ok });
});

const reinviaVerificaPubblicoSchema = z.object({ email: z.string().email() });

// Variante SENZA autenticazione: da quando il login è bloccato per gli
// account non verificati, un utente in questa situazione non ha modo di
// ottenere un JWT per chiamare l'endpoint sopra. Stessa protezione
// anti-enumerazione di /password-dimenticata: risposta identica a
// prescindere dal fatto che l'email esista o sia già verificata.
authRouter.post("/reinvia-verifica-email", async (req, res) => {
  const parsed = reinviaVerificaPubblicoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email non valida" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && user.attivo && !user.emailVerificata) {
    rigeneraEInviaVerifica(user, req).catch((err) =>
      console.error("[auth] Errore invio reinvio verifica:", err.message)
    );
  }

  res.json({ ok: true, messaggio: "Se l'email esiste e non è ancora verificata, riceverai a breve un nuovo link di verifica." });
});

const passwordDimenticataSchema = z.object({ email: z.string().email() });

// Risposta identica indipendentemente dal fatto che l'email esista o
// meno: evita che questo endpoint venga usato per scoprire quali email
// sono registrate sulla piattaforma (user enumeration).
authRouter.post("/password-dimenticata", async (req, res) => {
  const parsed = passwordDimenticataSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email non valida" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && user.attivo) {
    const resetPasswordToken = generaToken();
    const resetPasswordScadenza = new Date(Date.now() + RESET_PASSWORD_VALIDITA_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken, resetPasswordScadenza },
    });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const resetUrl = `${baseUrl}/reset-password/?token=${resetPasswordToken}`;
    inviaEmailResetPassword({ email: user.email, nome: user.nome, resetUrl }).catch((err) =>
      console.error("[auth] Errore invio email reset password:", err.message)
    );
  }

  res.json({ ok: true, messaggio: "Se l'email esiste, riceverai a breve le istruzioni per reimpostare la password." });
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { resetPasswordToken: parsed.data.token } });
  if (!user || !user.resetPasswordScadenza || user.resetPasswordScadenza < new Date()) {
    return res.status(400).json({ error: "Link di reset non valido o scaduto" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetPasswordToken: null, resetPasswordScadenza: null },
  });

  creaNotificaUtente({
    tenantId: user.tenantId,
    userId: user.id,
    categoria: "SICUREZZA",
    titolo: "Password reimpostata",
    messaggio: "La password del tuo account è stata reimpostata tramite il link di reset. Se non sei stato tu, contatta subito l'amministratore.",
  }).catch((err) => console.error("[notifiche] Errore creazione notifica reset password:", err.message));

  res.json({ ok: true });
});

const cambiaPasswordSchema = z.object({
  passwordAttuale: z.string().min(1),
  nuovaPassword: z.string().min(8),
});

authRouter.post("/cambia-password", requireAuth, async (req, res) => {
  const parsed = cambiaPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) return res.status(404).json({ error: "Utente non trovato" });

  const valid = await bcrypt.compare(parsed.data.passwordAttuale, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Password attuale non corretta" });

  const passwordHash = await bcrypt.hash(parsed.data.nuovaPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  creaNotificaUtente({
    tenantId: user.tenantId,
    userId: user.id,
    categoria: "SICUREZZA",
    titolo: "Password modificata",
    messaggio: "Hai cambiato la password del tuo account.",
  }).catch((err) => console.error("[notifiche] Errore creazione notifica cambio password:", err.message));

  res.json({ ok: true });
});

function signToken(user, tenantId) {
  return jwt.sign(
    { sub: user.id, tenantId, role: user.ruolo },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h" }
  );
}
