// Punto 19 del prompt SaaS (sicurezza): rate limiting sugli endpoint di
// autenticazione e restrizione CORS. Router montato isolatamente come gli
// altri test, senza toccare il database (questi controlli sono a livello
// HTTP, prima ancora di arrivare alla logica applicativa).

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cors from "cors";
import "dotenv/config";

process.env.JWT_SECRET = process.env.JWT_SECRET || "isolated-security-test-secret";

const { authRouter } = await import("../src/routes/auth.js");
const { loginLimiter } = await import("../src/middleware/rateLimit.js");

function buildAuthApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use((err, req, res, next) => { res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

function buildCorsApp(allowedOrigins) {
  const app = express();
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === "null" || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origine non consentita da CORS"));
    },
  }));
  app.get("/health", (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => { res.status(500).json({ error: "Errore interno del server" }); });
  return app;
}

test("Sicurezza: rate limiting sul login", async (t) => {
  const server = buildAuthApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await t.test("dopo il limite di tentativi risponde 429, non più 401", async () => {
      const results = [];
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "nessuno@example.invalid", password: "sbagliata" }),
        });
        results.push(res.status);
      }
      assert.ok(results.slice(0, 10).every((s) => s === 401), "i primi tentativi devono fallire per credenziali, non per rate limit: " + results);
      assert.ok(results.slice(10).every((s) => s === 429), "oltre il limite deve rispondere 429: " + results);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("Sicurezza: CORS ammette solo le origini configurate (e i client senza Origin)", async (t) => {
  const server = buildCorsApp(["https://www.rifless.it"]).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await t.test("origine consentita riceve l'header CORS", async () => {
      const res = await fetch(`${base}/health`, { headers: { Origin: "https://www.rifless.it" } });
      assert.equal(res.headers.get("access-control-allow-origin"), "https://www.rifless.it");
    });

    await t.test("origine 'null' (gestionale aperto come file locale) è ammessa", async () => {
      const res = await fetch(`${base}/health`, { headers: { Origin: "null" } });
      assert.equal(res.headers.get("access-control-allow-origin"), "null");
    });

    await t.test("richiesta senza header Origin (server-to-server, webhook) funziona comunque", async () => {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
    });

    await t.test("origine non in whitelist non riceve l'header CORS", async () => {
      const res = await fetch(`${base}/health`, { headers: { Origin: "https://sito-malevolo.example" } });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});
