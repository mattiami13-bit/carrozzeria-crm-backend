import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, tenantScope } from "../middleware/auth.js";
import { creaNotificaRuoli } from "../lib/notificheInApp.js";
import { costruisciExportTenant, avviaExportAsincrono, generaLinkScaricamento } from "../lib/dataExport.js";

export const gdprRouter = Router();

// Punto 42: periodo di grazia configurabile prima che un super-admin
// possa eseguire manualmente una richiesta di cancellazione account
// (mai un'esecuzione automatica — vedi il commento su
// Tenant.eliminazioneRichiestaAt in schema.prisma).
const GIORNI_GRAZIA_ELIMINAZIONE = Number(process.env.ACCOUNT_DELETION_GRACE_DAYS) || 30;
gdprRouter.use(requireAuth);

// GET /api/gdpr/export — esportazione dei dati operativi del tenant
// (punto 18/43 del prompt SaaS). Riservata ad ADMIN: contiene dati di
// tutti i clienti, non solo di chi la richiede. Nessun contenuto binario
// (foto/documenti) è incluso inline: solo i loro metadati, per non far
// esplodere le dimensioni dell'export e non duplicare storage sensibile.
gdprRouter.get("/export", requireRole("ADMIN"), async (req, res) => {
  const export_ = await costruisciExportTenant(req.auth.tenantId);

  const richiesta = await prisma.gdprRichiesta.create({
    data: { tenantId: req.auth.tenantId, tipo: "EXPORT_DATI", stato: "COMPLETATA", richiedenteId: req.auth.userId, risoltoAt: new Date() },
  });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="export-dati-${req.auth.tenantId}-${richiesta.id.slice(-6)}.json"`);
  res.json(export_);
});

// Punto 43 (export dati, "OWNER: ESPORTA DATI CARROZZERIA"): versione
// asincrona e sicura di GET /export sopra — la richiesta torna subito
// (IN_CORSO), il file si costruisce in background e diventa
// scaricabile solo tramite un link temporaneo firmato una volta pronto,
// con notifica (in-app + email). Vedi lib/dataExport.js.
gdprRouter.post("/export-asincrono", requireRole("ADMIN"), async (req, res) => {
  const richiesta = await avviaExportAsincrono({ tenantId: req.auth.tenantId, richiedenteId: req.auth.userId });
  res.status(202).json({ id: richiesta.id, stato: richiesta.stato, createdAt: richiesta.createdAt });
});

gdprRouter.get("/export-asincrono", requireRole("ADMIN"), async (req, res) => {
  const richieste = await prisma.dataExportRequest.findMany({
    where: tenantScope(req),
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, stato: true, erroreMessaggio: true, scadenza: true, createdAt: true, completatoAt: true },
  });
  res.json(richieste);
});

// GET /api/gdpr/export-asincrono/:id/download — genera il link
// temporaneo al momento, non lo salva né lo restituisce in anticipo:
// chi non è ADMIN di QUESTO tenant non può nemmeno arrivare a questa
// verifica (tenantScope), e un export di un altro tenant risulta 404,
// mai un dettaglio su "esiste ma non è tuo".
gdprRouter.get("/export-asincrono/:id/download", requireRole("ADMIN"), async (req, res) => {
  const richiesta = await prisma.dataExportRequest.findFirst({ where: { id: req.params.id, ...tenantScope(req) } });
  if (!richiesta) return res.status(404).json({ error: "Export non trovato" });
  if (richiesta.stato === "IN_CORSO") return res.status(409).json({ error: "L'export è ancora in preparazione." });
  if (richiesta.stato === "FALLITO") return res.status(410).json({ error: "La preparazione di questo export non è riuscita. Avviane uno nuovo." });

  const url = await generaLinkScaricamento(richiesta);
  if (!url) return res.status(410).json({ error: "Questo export è scaduto. Avviane uno nuovo." });
  res.json({ url });
});

// GET /api/gdpr/stato-eliminazione — per mostrare (o no) il banner
// "la tua organizzazione verrà eliminata il..." nel gestionale.
gdprRouter.get("/stato-eliminazione", async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.auth.tenantId },
    select: { ragioneSociale: true, eliminazioneRichiestaAt: true, eliminazionePrevistaPer: true },
  });
  res.json({
    ragioneSociale: tenant?.ragioneSociale ?? null,
    inEliminazione: !!tenant?.eliminazioneRichiestaAt,
    eliminazioneRichiestaAt: tenant?.eliminazioneRichiestaAt ?? null,
    eliminazionePrevistaPer: tenant?.eliminazionePrevistaPer ?? null,
  });
});

const richiestaCancellazioneSchema = z.object({
  password: z.string().min(1),
  confermaTestuale: z.string().min(1),
});

// POST /api/gdpr/richiesta-cancellazione-account — flusso Impostazioni
// → Account → Elimina organizzazione (punto 42). Non cancella nulla
// automaticamente: richiede riautenticazione (password) e conferma
// testuale (la ragione sociale esatta, per evitare un click per
// sbaglio), poi porta il tenant in stato PENDING_DELETION con un
// periodo di grazia configurabile — durante il quale il gestionale
// resta pienamente utilizzabile e la richiesta è annullabile in
// qualsiasi momento. La cancellazione reale di un intero tenant (con
// tutti i suoi dati operativi) resta una procedura manuale del
// super-admin dopo la scadenza del periodo di grazia — mai automatica,
// stesso principio già in vigore per la coda GdprRichiesta.
gdprRouter.post("/richiesta-cancellazione-account", requireRole("ADMIN"), async (req, res) => {
  const parsed = richiestaCancellazioneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Password e conferma testuale sono obbligatorie." });

  const [user, tenant] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.auth.userId } }),
    prisma.tenant.findUnique({ where: { id: req.auth.tenantId } }),
  ]);
  if (!user || !tenant) return res.status(404).json({ error: "Account non trovato" });

  const passwordValida = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordValida) return res.status(401).json({ error: "Password non corretta" });

  if (parsed.data.confermaTestuale.trim() !== tenant.ragioneSociale) {
    return res.status(400).json({ error: `Per confermare, scrivi esattamente "${tenant.ragioneSociale}".` });
  }

  if (tenant.eliminazioneRichiestaAt) {
    return res.status(409).json({ error: "Esiste già una richiesta di cancellazione in corso per questa organizzazione." });
  }

  const ora = new Date();
  const previstaPer = new Date(ora.getTime() + GIORNI_GRAZIA_ELIMINAZIONE * 24 * 60 * 60 * 1000);

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { eliminazioneRichiestaAt: ora, eliminazionePrevistaPer: previstaPer },
  });

  const richiesta = await prisma.gdprRichiesta.create({
    data: {
      tenantId: req.auth.tenantId, tipo: "CANCELLAZIONE_ACCOUNT", richiedenteId: req.auth.userId,
      note: `Periodo di grazia: eliminazione prevista per il ${previstaPer.toISOString().slice(0, 10)} (${GIORNI_GRAZIA_ELIMINAZIONE} giorni). Annullabile dall'organizzazione fino ad allora.`,
    },
  });

  creaNotificaRuoli({
    tenantId: req.auth.tenantId,
    ruoli: ["ADMIN"],
    categoria: "SICUREZZA",
    titolo: "Cancellazione organizzazione richiesta",
    messaggio: `L'organizzazione verrà eliminata il ${previstaPer.toLocaleDateString("it-IT")} se la richiesta non viene annullata prima. Nessun dato è stato ancora eliminato.`,
  }).catch((err) => console.error("[gdpr] Errore creazione notifica richiesta cancellazione:", err.message));

  res.status(201).json({
    ok: true,
    richiesta,
    eliminazionePrevistaPer: previstaPer,
    messaggio: `Richiesta registrata. La tua organizzazione verrà eliminata il ${previstaPer.toLocaleDateString("it-IT")} se non annulli prima da questa stessa pagina.`,
  });
});

// POST /api/gdpr/annulla-cancellazione-account — direzione sicura,
// nessuna riautenticazione richiesta: un ADMIN può sempre fermare una
// cancellazione già richiesta finché è ancora in periodo di grazia.
gdprRouter.post("/annulla-cancellazione-account", requireRole("ADMIN"), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  if (!tenant?.eliminazioneRichiestaAt) {
    return res.status(400).json({ error: "Nessuna richiesta di cancellazione in corso da annullare." });
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { eliminazioneRichiestaAt: null, eliminazionePrevistaPer: null },
  });

  await prisma.gdprRichiesta.updateMany({
    where: { tenantId: req.auth.tenantId, tipo: "CANCELLAZIONE_ACCOUNT", stato: "IN_ATTESA" },
    data: { stato: "ANNULLATA", risoltoAt: new Date() },
  });

  creaNotificaRuoli({
    tenantId: req.auth.tenantId,
    ruoli: ["ADMIN"],
    categoria: "SICUREZZA",
    titolo: "Cancellazione organizzazione annullata",
    messaggio: "La richiesta di cancellazione dell'organizzazione è stata annullata. L'account resta attivo.",
  }).catch((err) => console.error("[gdpr] Errore creazione notifica annullamento cancellazione:", err.message));

  res.json({ ok: true, messaggio: "Richiesta di cancellazione annullata. La tua organizzazione resta attiva." });
});

gdprRouter.get("/richieste", requireRole("ADMIN"), async (req, res) => {
  const richieste = await prisma.gdprRichiesta.findMany({
    where: tenantScope(req),
    orderBy: { createdAt: "desc" },
    include: { richiedente: { select: { nome: true, cognome: true } } },
  });
  res.json(richieste);
});
