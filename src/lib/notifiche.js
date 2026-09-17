import { Resend } from "resend";
import { getPortalLink } from "./portaleHelper.js";
import { prisma } from "./prisma.js";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Messaggi personalizzati per ogni stato che vogliamo comunicare al cliente.
// Tutti gli stage del ciclo di lavorazione sono presenti in questa mappa:
// ogni cambio di stato genera una notifica email/WhatsApp al cliente.
const MESSAGGI_STAGE = {
    ACCETTAZIONE: (v) =>
    `Ciao ${v.clientNome}, abbiamo accettato la tua ${v.marca} ${v.modello} (targa ${v.targa}) in carrozzeria. Seguirà a breve un preventivo.\n\nSegui l'avanzamento qui: ${v.link}`,
  PREVENTIVO: (v) =>
    `Ciao ${v.clientNome}, stiamo preparando il preventivo per la tua ${v.marca} ${v.modello} (targa ${v.targa}). Ti contatteremo appena pronto.\n\nSegui l'avanzamento qui: ${v.link}`,
  ORDINE_RICAMBI: (v) =>
    `Ciao ${v.clientNome}, stiamo ordinando i ricambi necessari per la tua ${v.marca} ${v.modello} (targa ${v.targa}).\n\nSegui l'avanzamento qui: ${v.link}`,
  PREPARAZIONE: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è in fase di preparazione.\n\nSegui l'avanzamento qui: ${v.link}`,
  VERNICIATURA: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è in verniciatura.\n\nSegui l'avanzamento qui: ${v.link}`,
  LUCIDATURA: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è in fase di lucidatura.\n\nSegui l'avanzamento qui: ${v.link}`,
  CONTROLLO_QUALITA: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è in controllo qualità finale.\n\nSegui l'avanzamento qui: ${v.link}`,
  LAVAGGIO: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è in fase di lavaggio, quasi pronta!\n\nSegui l'avanzamento qui: ${v.link}`,
ATTESA_APPROVAZIONE: (v) =>
    `Ciao ${v.clientNome}, il preventivo per la tua ${v.marca} ${v.modello} (targa ${v.targa}) è pronto. Ti contatteremo a breve per l'approvazione.\n\nSegui l'avanzamento qui: ${v.link}`,
  IN_LAVORAZIONE: (v) =>
    `Ciao ${v.clientNome}, la lavorazione della tua ${v.marca} ${v.modello} (targa ${v.targa}) è iniziata.\n\nSegui l'avanzamento qui: ${v.link}`,
  PRONTA_CONSEGNA: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è pronta per il ritiro!\n\nDettagli qui: ${v.link}`,
  CONSEGNATA: (v) =>
    `Ciao ${v.clientNome}, grazie per aver scelto la nostra carrozzeria per la tua ${v.marca} ${v.modello}. Alla prossima!\n\nRivedi tutto qui: ${v.link}`,
};
const OGGETTO_EMAIL = {
    ACCETTAZIONE: "Veicolo accettato in carrozzeria",
  PREVENTIVO: "Preventivo in preparazione",
  ORDINE_RICAMBI: "Ricambi in ordinazione",
  PREPARAZIONE: "Veicolo in preparazione",
  VERNICIATURA: "Veicolo in verniciatura",
  LUCIDATURA: "Veicolo in lucidatura",
  CONTROLLO_QUALITA: "Controllo qualità in corso",
  LAVAGGIO: "Veicolo in fase di lavaggio",
  ATTESA_APPROVAZIONE: "Preventivo pronto",
  IN_LAVORAZIONE: "Lavorazione iniziata",
  PRONTA_CONSEGNA: "Auto pronta per il ritiro",
  CONSEGNATA: "Consegna completata",
};

/**
 * Invia una notifica email al cliente quando il veicolo cambia stato,
 * solo per gli stati presenti in MESSAGGI_STAGE.
 *
 * Punto 40 (usage tracking): trovato e corretto un invio WhatsApp
 * duplicato qui — questa funzione mandava un secondo messaggio WhatsApp
 * (via un client Twilio proprio, senza tracciamento né controllo
 * dell'entitlement di piano) per lo STESSO cambio di stato per cui
 * routes/vehicles.js e routes/quotes.js chiamano già
 * inviaComunicazioneWhatsapp (lib/whatsapp.js), che è la versione
 * corretta: usa i template WhatsappTemplate reali, rispetta le
 * preferenze di notifica del cliente, e scrive una riga WhatsappMessage
 * tracciata. Ogni cliente riceveva quindi due WhatsApp per ogni cambio
 * di stato, e il secondo costava una chiamata Twilio reale mai visibile
 * da nessuna parte. Ora questa funzione gestisce solo l'email.
 *
 * @param {object} vehicle - il veicolo aggiornato, con relazione client inclusa
 * @param {string} newStage - il nuovo stato (es. "PRONTA_CONSEGNA")
 */
export async function enqueueNotification(vehicle, newStage, baseUrl) {
  const template = MESSAGGI_STAGE[newStage];
  if (!template) return; // stato non "comunicabile" al cliente, nessuna notifica

  const client = vehicle.client;
  if (!client) {
    console.warn(`[notifiche] Veicolo ${vehicle.id}: nessun cliente collegato, salto notifica`);
    return;
  }

  const link = await getPortalLink(baseUrl, vehicle.tenantId, vehicle.id);

  const testo = template({
    clientNome: client.nome,
    marca: vehicle.marca,
    modello: vehicle.modello,
    targa: vehicle.targa,
    link,
  });
  if (client.email && resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: "Rifless <notifiche@rifless.it>",
        to: client.email,
        subject: OGGETTO_EMAIL[newStage] || "Aggiornamento veicolo",
        text: testo,
      });
      if (error) {
        console.error(`[notifiche] Errore invio email a ${client.email}:`, JSON.stringify(error));
      } else {
        console.log(`[notifiche] Email inviata a ${client.email} (stage ${newStage}), id: ${data?.id}`);
        await prisma.usageEvent.create({ data: { tenantId: vehicle.tenantId, tipo: "EMAIL", dettaglio: `stage:${newStage}` } })
          .catch((err) => console.error("[usage] Log email fallito:", err.message));
      }
    } catch (err) {
      console.error(`[notifiche] Errore invio email a ${client.email}:`, err.message);
    }
  }
}

/**
 * Invia al cliente il link di accesso al portale (stato veicolo, foto,
 * preventivo, sinistro). Chiamata quando lo staff genera il link dalla
 * scheda veicolo.
 *
 * @param {object} vehicle - il veicolo, con relazione client inclusa
 * @param {string} link - URL completo del portale già pronto all'uso
 */
export async function inviaLinkPortale(vehicle, link) {
  const client = vehicle.client;
  if (!client?.email || !resend) return;

  const testo = `Ciao ${client.nome}, puoi seguire lo stato della tua ${vehicle.marca} ${vehicle.modello} (targa ${vehicle.targa}) a questo link:\n\n${link}\n\nTroverai stato di lavorazione, foto e, se presente, il preventivo da firmare.`;

  try {
    const { data, error } = await resend.emails.send({
      from: "Rifless <notifiche@rifless.it>",
      to: client.email,
      subject: "Segui la tua auto in tempo reale",
      text: testo,
    });
    if (error) {
      console.error(`[notifiche] Errore invio link portale a ${client.email}:`, JSON.stringify(error));
    } else {
      console.log(`[notifiche] Link portale inviato a ${client.email}, id: ${data?.id}`);
      await prisma.usageEvent.create({ data: { tenantId: vehicle.tenantId, tipo: "EMAIL", dettaglio: "link-portale" } })
        .catch((err) => console.error("[usage] Log email fallito:", err.message));
    }
  } catch (err) {
    console.error(`[notifiche] Errore invio link portale a ${client.email}:`, err.message);
  }
}