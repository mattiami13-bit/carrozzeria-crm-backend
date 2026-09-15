// Verifica email, password dimenticata/reset e cambio password: usa
// l'app HTTP vera (stesso router montato da src/index.js) contro il
// database reale, dati creati e ripuliti a fine test. RESEND_API_KEY
// non è configurata in locale, quindi l'invio email è un no-op
// controllato (vedi src/lib/email.js) e non blocca i test.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-auth-test-secret";

const { prisma } = await import("../src/lib/prisma.js");
const { authRouter } = await import("../src/routes/auth.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

test("Verifica email, reset password e cambio password", async (t) => {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout: nessuna risposta da ${init.method || "GET"} ${path} entro 8s`)), 8000);
    return fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    }).finally(() => clearTimeout(timer));
  };

  const suffix = Date.now();
  const created = { tenants: [] };

  try {
    await t.test("register crea un utente non verificato con token di verifica", async () => {
      const res = await call("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          ragioneSociale: `Auth Test ${suffix}`,
          nomeAdmin: "Anna",
          cognomeAdmin: "Verdi",
          email: `auth.test.${suffix}@example.invalid`,
          password: "Test1234!Auth",
        }),
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.user.emailVerificata, false);
      created.tenants.push(data.tenant.id);

      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });
      assert.ok(user.emailVerificaToken, "il token di verifica deve essere stato generato");
      assert.ok(user.emailVerificaScadenza > new Date(), "il token deve avere una scadenza futura");
    });

    await t.test("login è bloccato finché l'email non è verificata, anche con password corretta", async () => {
      const res = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "Test1234!Auth" }),
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.emailNonVerificata, true);
    });

    await t.test("login con password sbagliata su un account non verificato resta un generico 401 (no info leak)", async () => {
      const res = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "PasswordSbagliata!" }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("reinvia-verifica-email (pubblico, senza login) risponde uguale per email esistenti/inesistenti/già verificate", async () => {
      const resEsistente = await call("/api/auth/reinvia-verifica-email", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid` }),
      });
      const resInesistente = await call("/api/auth/reinvia-verifica-email", {
        method: "POST",
        body: JSON.stringify({ email: `non.esiste.${suffix}@example.invalid` }),
      });
      assert.equal(resEsistente.status, 200);
      assert.equal(resInesistente.status, 200);
      const dataEsistente = await resEsistente.json();
      const dataInesistente = await resInesistente.json();
      assert.equal(dataEsistente.messaggio, dataInesistente.messaggio);

      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });
      assert.ok(user.emailVerificaToken, "un nuovo token di verifica deve essere stato generato dall'endpoint pubblico");
    });

    await t.test("verifica email con token errato viene rifiutata", async () => {
      const res = await call("/api/auth/verifica-email?token=token-inventato-non-esistente");
      assert.equal(res.status, 400);
    });

    await t.test("verifica email con token corretto marca l'utente come verificato", async () => {
      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });
      const res = await call(`/api/auth/verifica-email?token=${user.emailVerificaToken}`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);

      const aggiornato = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(aggiornato.emailVerificata, true);
      assert.equal(aggiornato.emailVerificaToken, null, "il token va consumato dopo l'uso");
    });

    await t.test("lo stesso token non è più valido dopo il consumo", async () => {
      const res = await call("/api/auth/verifica-email?token=token-inventato-non-esistente");
      assert.equal(res.status, 400);
    });

    await t.test("password dimenticata: risposta identica sia per email esistente sia inesistente (no enumeration)", async () => {
      const resEsistente = await call("/api/auth/password-dimenticata", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid` }),
      });
      const resInesistente = await call("/api/auth/password-dimenticata", {
        method: "POST",
        body: JSON.stringify({ email: `non.esiste.${suffix}@example.invalid` }),
      });
      assert.equal(resEsistente.status, 200);
      assert.equal(resInesistente.status, 200);
      const dataEsistente = await resEsistente.json();
      const dataInesistente = await resInesistente.json();
      assert.equal(dataEsistente.messaggio, dataInesistente.messaggio);

      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });
      assert.ok(user.resetPasswordToken, "il token di reset deve essere stato generato per l'email esistente");
    });

    await t.test("reset password con token scaduto viene rifiutato", async () => {
      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });
      await prisma.user.update({ where: { id: user.id }, data: { resetPasswordScadenza: new Date(Date.now() - 1000) } });

      const res = await call("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: user.resetPasswordToken, password: "NuovaPassword123!" }),
      });
      assert.equal(res.status, 400);
    });

    await t.test("reset password con token valido aggiorna la password e permette il login", async () => {
      const resDimenticata = await call("/api/auth/password-dimenticata", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid` }),
      });
      assert.equal(resDimenticata.status, 200);
      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });

      const resReset = await call("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: user.resetPasswordToken, password: "NuovaPassword123!" }),
      });
      assert.equal(resReset.status, 200);

      const resLoginVecchia = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "Test1234!Auth" }),
      });
      assert.equal(resLoginVecchia.status, 401, "la vecchia password non deve più funzionare");

      const resLoginNuova = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "NuovaPassword123!" }),
      });
      assert.equal(resLoginNuova.status, 200, "la nuova password deve funzionare");

      const aggiornato = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(aggiornato.resetPasswordToken, null, "il token di reset va consumato dopo l'uso");
    });

    await t.test("cambia password richiede autenticazione e la password attuale corretta", async () => {
      const resLogin = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "NuovaPassword123!" }),
      });
      const { token } = await resLogin.json();

      const resSenzaAuth = await call("/api/auth/cambia-password", {
        method: "POST",
        body: JSON.stringify({ passwordAttuale: "NuovaPassword123!", nuovaPassword: "AncoraNuova123!" }),
      });
      assert.equal(resSenzaAuth.status, 401);

      const resPasswordSbagliata = await call("/api/auth/cambia-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ passwordAttuale: "PasswordSbagliata!", nuovaPassword: "AncoraNuova123!" }),
      });
      assert.equal(resPasswordSbagliata.status, 401);

      const resOk = await call("/api/auth/cambia-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ passwordAttuale: "NuovaPassword123!", nuovaPassword: "AncoraNuova123!" }),
      });
      assert.equal(resOk.status, 200);

      const resLoginFinale = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "AncoraNuova123!" }),
      });
      assert.equal(resLoginFinale.status, 200);
    });

    await t.test("reinvia verifica: no-op se già verificata, altrimenti genera un nuovo token", async () => {
      const resLogin = await call("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: `auth.test.${suffix}@example.invalid`, password: "AncoraNuova123!" }),
      });
      const { token } = await resLogin.json();

      const resGiaVerificata = await call("/api/auth/reinvia-verifica", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(resGiaVerificata.status, 200);
      const dataGiaVerificata = await resGiaVerificata.json();
      assert.equal(dataGiaVerificata.giaVerificata, true);

      // Riportiamo l'utente a non verificato per testare la rigenerazione del token.
      const user = await prisma.user.findUnique({ where: { email: `auth.test.${suffix}@example.invalid` } });
      await prisma.user.update({ where: { id: user.id }, data: { emailVerificata: false } });

      const resReinvia = await call("/api/auth/reinvia-verifica", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(resReinvia.status, 200);
      const aggiornato = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(aggiornato.emailVerificaToken, "un nuovo token di verifica deve essere stato generato");
    });
  } finally {
    // Pulizia in ordine di dipendenza: prima gli utenti, poi i tenant.
    for (const tenantId of created.tenants) {
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    await new Promise((r) => server.close(r));
  }
});
