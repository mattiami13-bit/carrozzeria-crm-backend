import { Resend } from "resend";
import { prisma } from "./prisma.js";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MITTENTE = "Rifless <notifiche@rifless.it>";

// Wrapper minimo di stile per email transazionali: layout a card centrata,
// leggibile anche senza CSS esterno (i client email non caricano <style>
// affidabilmente), pulsante di invito all'azione in blu brand.
function layoutEmail({ titolo, corpoHtml, ctaLabel, ctaUrl }) {
  return `<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:24px 16px;background:#F1EFE8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E4E1D8;">
    <tr><td style="background:#0A0B0D;padding:20px 28px;">
      <span style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:0.02em;">Rifless</span>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 14px;font-size:19px;color:#15171B;">${titolo}</h1>
      <div style="font-size:14.5px;line-height:1.6;color:#3A3D42;">${corpoHtml}</div>
      ${ctaUrl ? `
      <table role="presentation" style="margin-top:22px;">
        <tr><td style="border-radius:9px;background:#2F80ED;">
          <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;">${ctaLabel}</a>
        </td></tr>
      </table>
      <div style="margin-top:14px;font-size:12px;color:#8D9099;word-break:break-all;">Se il pulsante non funziona, copia questo link nel browser:<br>${ctaUrl}</div>` : ""}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#F8F7F3;font-size:11.5px;color:#A8A29B;">
      Rifless — il gestionale per carrozzerie. Se non hai richiesto questa email, puoi ignorarla.
    </td></tr>
  </table>
</body>
</html>`;
}

// Punto 40 (usage tracking): un UsageEvent per ogni email davvero
// tentata (non quando RESEND_API_KEY manca e non si tenta nulla — quel
// caso è solo sviluppo/test locale, non uso reale). tenantId è
// opzionale: alcune email (lead commerciali) non riguardano un tenant.
async function registraUsoEmail(tenantId, subject) {
  await prisma.usageEvent.create({ data: { tenantId: tenantId ?? undefined, tipo: "EMAIL", dettaglio: subject } })
    .catch((err) => console.error("[usage] Log email fallito:", err.message));
}

async function inviaConRetry({ to, subject, html, text, tenantId }, tentativi = 2) {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY assente, email non inviata a ${to} (${subject})`);
    return { ok: false, motivo: "provider non configurato" };
  }
  let ultimoErrore = null;
  for (let tentativo = 1; tentativo <= tentativi; tentativo++) {
    try {
      const { data, error } = await resend.emails.send({ from: MITTENTE, to, subject, html, text });
      if (error) throw new Error(JSON.stringify(error));
      console.log(`[email] Inviata a ${to} (${subject}), id: ${data?.id}, tentativo ${tentativo}`);
      await registraUsoEmail(tenantId, subject);
      return { ok: true, id: data?.id };
    } catch (err) {
      ultimoErrore = err;
      console.error(`[email] Tentativo ${tentativo}/${tentativi} fallito verso ${to} (${subject}):`, err.message);
      if (tentativo < tentativi) await new Promise((r) => setTimeout(r, 500 * tentativo));
    }
  }
  await registraUsoEmail(tenantId, subject);
  return { ok: false, motivo: ultimoErrore?.message };
}

export async function inviaEmailBenvenuto({ email, nome, ragioneSociale, verificaUrl, tenantId }) {
  const html = layoutEmail({
    titolo: `Benvenuto su Rifless, ${nome}`,
    corpoHtml: `<p>L'account per <strong>${ragioneSociale}</strong> è stato creato. Prima di iniziare, conferma il tuo indirizzo email cliccando il pulsante qui sotto.</p>`,
    ctaLabel: "Verifica la tua email",
    ctaUrl: verificaUrl,
  });
  const text = `Benvenuto su Rifless, ${nome}. L'account per ${ragioneSociale} è stato creato. Verifica la tua email: ${verificaUrl}`;
  return inviaConRetry({ to: email, subject: "Benvenuto su Rifless — verifica la tua email", html, text, tenantId });
}

export async function inviaEmailVerifica({ email, nome, verificaUrl, tenantId }) {
  const html = layoutEmail({
    titolo: "Verifica la tua email",
    corpoHtml: `<p>Ciao ${nome}, conferma il tuo indirizzo email per completare l'attivazione dell'account Rifless.</p>`,
    ctaLabel: "Verifica la tua email",
    ctaUrl: verificaUrl,
  });
  const text = `Ciao ${nome}, verifica la tua email: ${verificaUrl}`;
  return inviaConRetry({ to: email, subject: "Verifica la tua email Rifless", html, text, tenantId });
}

// Destinatario interno per lead commerciali (contatti, richieste demo):
// mai hardcoded, configurabile perché in futuro potrebbe non essere
// più l'indirizzo del solo proprietario.
const DESTINATARIO_LEAD = process.env.CONTATTI_EMAIL_DESTINATARIO || "info@rifless.it";

export async function inviaNotificaLeadCommerciale({ nome, cognome, carrozzeria, email, telefono, numeroDipendenti, messaggio, origine }) {
  const righe = [
    `Nome: ${nome}${cognome ? ` ${cognome}` : ""}`,
    `Carrozzeria: ${carrozzeria}`,
    `Email: ${email}`,
    telefono ? `Telefono: ${telefono}` : null,
    numeroDipendenti != null ? `Numero dipendenti: ${numeroDipendenti}` : null,
    messaggio ? `Messaggio: ${messaggio}` : null,
  ].filter(Boolean);
  const testo = righe.join("\n");
  const html = layoutEmail({
    titolo: origine === "DEMO" ? "Nuova richiesta demo" : "Nuovo contatto commerciale",
    corpoHtml: `<p>${righe.map((r) => r.replace(/</g, "&lt;")).join("<br>")}</p>`,
  });
  return inviaConRetry({
    to: DESTINATARIO_LEAD,
    subject: origine === "DEMO" ? `Richiesta demo — ${carrozzeria}` : `Nuovo contatto — ${carrozzeria}`,
    html,
    text: testo,
  });
}

const CATEGORIA_LABEL = { SUPPORTO: "Richiesta di supporto", BUG: "Segnalazione problema", FUNZIONALITA: "Richiesta funzionalità" };

// Punto 37 (supporto cliente): notifica interna best-effort per ogni
// nuovo ticket, stesso destinatario dei lead commerciali — non è un
// pubblico diverso, è sempre chi gestisce la piattaforma.
export async function inviaNotificaTicket({ ragioneSociale, categoria, priorita, messaggio, utente, tenantId }) {
  const titolo = `${CATEGORIA_LABEL[categoria] || "Nuovo ticket"} — ${ragioneSociale}`;
  const righe = [
    `Carrozzeria: ${ragioneSociale}`,
    `Da: ${utente}`,
    `Priorità: ${priorita}`,
    `Messaggio: ${messaggio}`,
  ];
  const html = layoutEmail({
    titolo,
    corpoHtml: `<p>${righe.map((r) => r.replace(/</g, "&lt;")).join("<br>")}</p>`,
  });
  return inviaConRetry({ to: DESTINATARIO_LEAD, subject: titolo, html, text: righe.join("\n"), tenantId });
}

// Punto 43 (export dati asincrono): notifica quando l'export è pronto.
// Mai un link di download diretto nella mail — porta al gestionale
// (dove il download richiede login), coerente col resto dell'app: nessun
// dato dei clienti dietro un link cliccabile senza autenticazione.
const APP_URL_PER_EMAIL = process.env.PUBLIC_APP_URL || "https://app.rifless.it";

export async function inviaEmailExportPronto({ email, nome, tenantId }) {
  const html = layoutEmail({
    titolo: "Il tuo export dati è pronto",
    corpoHtml: `<p>Ciao ${nome}, l'export dei dati della tua carrozzeria è pronto. Accedi al gestionale e apri "Privacy e dati" per scaricarlo — il link di download è valido per un tempo limitato una volta generato.</p>`,
    ctaLabel: "Apri il gestionale",
    ctaUrl: APP_URL_PER_EMAIL,
  });
  const text = `Ciao ${nome}, l'export dei dati della tua carrozzeria è pronto. Accedi al gestionale (${APP_URL_PER_EMAIL}) e apri "Privacy e dati" per scaricarlo.`;
  return inviaConRetry({ to: email, subject: "Il tuo export dati Rifless è pronto", html, text, tenantId });
}

export async function inviaEmailResetPassword({ email, nome, resetUrl, tenantId }) {
  const html = layoutEmail({
    titolo: "Reimposta la password",
    corpoHtml: `<p>Ciao ${nome}, abbiamo ricevuto una richiesta di reset della password del tuo account Rifless. Il link è valido per 1 ora. Se non sei stato tu, ignora questa email: la password attuale resta invariata.</p>`,
    ctaLabel: "Reimposta password",
    ctaUrl: resetUrl,
  });
  const text = `Ciao ${nome}, reimposta la password (valido 1 ora): ${resetUrl}`;
  return inviaConRetry({ to: email, subject: "Reimposta la password Rifless", html, text, tenantId });
}
