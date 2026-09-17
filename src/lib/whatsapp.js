import twilio from "twilio";
import { prisma } from "./prisma.js";
import { getPortalLink } from "./portaleHelper.js";

// Comunicazioni automatiche WhatsApp legate al workflow della pratica.
// Canale: Twilio come Meta Business Solution Provider ufficiale per
// WhatsApp Business (nessuna libreria/automazione non ufficiale) — stesso
// account già usato dal modulo notifiche esistente.
//
// I messaggi business-initiated su WhatsApp devono usare un template
// approvato da Meta se il cliente non ha scritto nelle ultime 24 ore: per
// questo il testo personalizzato dal singolo tenant viene inviato come
// variabile di un unico Content Template WhatsApp già approvato
// (TWILIO_WHATSAPP_CONTENT_SID), anziché come testo libero. In questo modo
// ogni carrozzeria può personalizzare liberamente il testo senza dover
// richiedere una nuova approvazione Meta per ogni frase.
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const CONTENT_SID = process.env.TWILIO_WHATSAPP_CONTENT_SID || "HXd35dced652dac1e2a55e7838bed5aff0";

export const WHATSAPP_EVENTI = [
  "ACCETTAZIONE", "PREVENTIVO", "ATTESA_APPROVAZIONE", "ORDINE_RICAMBI",
  "IN_LAVORAZIONE", "PREPARAZIONE", "VERNICIATURA", "LUCIDATURA",
  "CONTROLLO_QUALITA", "LAVAGGIO", "PRONTA_CONSEGNA", "CONSEGNATA",
  "RICAMBIO_RITARDO",
];

export const EVENTO_LABEL = {
  ACCETTAZIONE: "Vettura ricevuta",
  PREVENTIVO: "Preventivo in preparazione",
  ATTESA_APPROVAZIONE: "Preventivo pronto per approvazione",
  ORDINE_RICAMBI: "Ricambi in ordinazione",
  IN_LAVORAZIONE: "Lavorazione iniziata",
  PREPARAZIONE: "Veicolo in preparazione",
  VERNICIATURA: "Verniciatura completata",
  LUCIDATURA: "Veicolo in lucidatura",
  CONTROLLO_QUALITA: "Controllo qualità in corso",
  LAVAGGIO: "Veicolo in fase di lavaggio",
  PRONTA_CONSEGNA: "Vettura pronta",
  CONSEGNATA: "Vettura consegnata",
  RICAMBIO_RITARDO: "Ricambio in ritardo",
};

// Testo usato per lo "stato" leggibile nella variabile {{stato}} e come
// bozza iniziale proposta all'amministratore quando attiva un evento per
// la prima volta.
export const TEMPLATE_DEFAULT = {
  ACCETTAZIONE: "Ciao {{nome_cliente}}, confermiamo di aver accettato in carrozzeria la tua {{veicolo}} (targa {{targa}}), pratica {{numero_pratica}}. Ti terremo aggiornato sull'avanzamento.\n\nSegui la pratica qui: {{link_portale}}",
  PREVENTIVO: "Ciao {{nome_cliente}}, stiamo preparando il preventivo per la tua {{veicolo}} (targa {{targa}}).\n\nSegui la pratica qui: {{link_portale}}",
  ATTESA_APPROVAZIONE: "Ciao {{nome_cliente}}, il preventivo per la tua {{veicolo}} (targa {{targa}}) è pronto. Ti contatteremo a breve per l'approvazione.\n\nDettagli qui: {{link_portale}}",
  ORDINE_RICAMBI: "Ciao {{nome_cliente}}, stiamo ordinando i ricambi necessari per la tua {{veicolo}} (targa {{targa}}).\n\nSegui la pratica qui: {{link_portale}}",
  IN_LAVORAZIONE: "Ciao {{nome_cliente}}, la lavorazione della tua {{veicolo}} (targa {{targa}}) è iniziata. Pratica {{numero_pratica}}.\n\nSegui la pratica qui: {{link_portale}}",
  PREPARAZIONE: "Ciao {{nome_cliente}}, la tua {{veicolo}} (targa {{targa}}) è in fase di preparazione.\n\nSegui la pratica qui: {{link_portale}}",
  VERNICIATURA: "Ciao {{nome_cliente}}, la verniciatura della tua {{veicolo}} (targa {{targa}}) è completata. Si prosegue con le fasi successive.\n\nSegui la pratica qui: {{link_portale}}",
  LUCIDATURA: "Ciao {{nome_cliente}}, la tua {{veicolo}} (targa {{targa}}) è in fase di lucidatura.\n\nSegui la pratica qui: {{link_portale}}",
  CONTROLLO_QUALITA: "Ciao {{nome_cliente}}, la tua {{veicolo}} (targa {{targa}}) è in controllo qualità finale.\n\nSegui la pratica qui: {{link_portale}}",
  LAVAGGIO: "Ciao {{nome_cliente}}, la tua {{veicolo}} (targa {{targa}}) è in fase di lavaggio, quasi pronta!\n\nSegui la pratica qui: {{link_portale}}",
  PRONTA_CONSEGNA: "Ciao {{nome_cliente}}, la tua {{veicolo}} (targa {{targa}}) è pronta per il ritiro! Consegna prevista: {{data_consegna}}.\n\nDettagli qui: {{link_portale}}",
  CONSEGNATA: "Ciao {{nome_cliente}}, grazie per aver scelto la nostra carrozzeria per la tua {{veicolo}}. Alla prossima!\n\nRivedi la pratica qui: {{link_portale}}",
  RICAMBIO_RITARDO: "Ciao {{nome_cliente}}, ti aggiorniamo sulla tua {{veicolo}} (targa {{targa}}): un ricambio necessario sta subendo un ritardo nella consegna. Ti terremo informato appena avremo una data più precisa.\n\nSegui la pratica qui: {{link_portale}}",
};

const VARIABILI = ["nome_cliente", "veicolo", "targa", "numero_pratica", "stato", "data_consegna", "link_portale"];

function renderTemplate(testo, vars) {
  let out = String(testo || "");
  for (const key of VARIABILI) {
    out = out.split(`{{${key}}}`).join(vars[key] ?? "");
  }
  return out;
}

function normalizzaNumero(telefono) {
  const t = String(telefono || "").trim();
  if (!t) return null;
  return t.startsWith("+") ? t : `+39${t.replace(/\D/g, "")}`;
}

async function costruisciVariabili(vehicle, evento, baseUrl) {
  const client = vehicle.client;
  const sinistro = Array.isArray(vehicle.sinistri) ? vehicle.sinistri[0] : null;
  const link = await getPortalLink(baseUrl, vehicle.tenantId, vehicle.id);
  return {
    nome_cliente: client ? `${client.nome} ${client.cognome}`.trim() : "",
    veicolo: `${vehicle.marca} ${vehicle.modello}`.trim(),
    targa: vehicle.targa || "",
    numero_pratica: sinistro?.numeroPratica || vehicle.id.slice(-8).toUpperCase(),
    stato: EVENTO_LABEL[evento] || evento,
    data_consegna: vehicle.dataPrevistaConsegna
      ? new Date(vehicle.dataPrevistaConsegna).toLocaleDateString("it-IT")
      : "da definire",
    link_portale: link,
  };
}

// Invia (se l'amministratore ha attivato l'evento e il cliente ha dato il
// consenso) la comunicazione WhatsApp legata a un evento della pratica, e
// ne registra sempre l'esito nella pratica (WhatsappMessage). Non lancia
// mai eccezioni verso il chiamante: un problema nell'invio WhatsApp non
// deve mai bloccare il salvataggio del cambio di stato.
//
// @param {object} vehicle - veicolo con relazioni client e sinistri incluse
// @param {string} evento - uno dei WHATSAPP_EVENTI
// @param {string} baseUrl - origine pubblica dell'app (per il link portale)
// @param {string|null} inviatoDaId - utente che ha causato l'invio (cambio stato/manuale)
export async function inviaComunicazioneWhatsapp(vehicle, evento, baseUrl, inviatoDaId = null) {
  try {
    if (!WHATSAPP_EVENTI.includes(evento)) return null;

    const template = await prisma.whatsappTemplate.findUnique({
      where: { tenantId_evento: { tenantId: vehicle.tenantId, evento } },
    });
    if (!template || !template.attivo) return null; // l'amministratore non ha attivato questo evento

    const client = vehicle.client;
    if (!client) {
      console.warn(`[whatsapp] Veicolo ${vehicle.id}: nessun cliente collegato, salto invio`);
      return null;
    }
    if (!client.notificheWhatsappConsenso || !client.notificheWhatsappAttive) {
      console.log(`[whatsapp] Cliente ${client.id}: notifiche non consentite/disattivate, salto invio (evento ${evento})`);
      return null;
    }
    const numero = normalizzaNumero(client.telefono);
    if (!numero) {
      console.warn(`[whatsapp] Cliente ${client.id}: nessun numero di telefono, salto invio (evento ${evento})`);
      return null;
    }

    const vars = await costruisciVariabili(vehicle, evento, baseUrl);
    const testo = renderTemplate(template.testo, vars);

    if (!twilioClient || !process.env.TWILIO_WHATSAPP_NUMBER) {
      return prisma.whatsappMessage.create({
        data: {
          tenantId: vehicle.tenantId, vehicleId: vehicle.id, clientId: client.id,
          evento, testo, telefono: numero, stato: "FALLITO",
          errore: "Integrazione WhatsApp (Twilio) non configurata.",
          inviatoDaId,
        },
      });
    }

    try {
      const msg = await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${numero}`,
        contentSid: CONTENT_SID,
        contentVariables: JSON.stringify({ "1": testo }),
        statusCallback: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL || `${baseUrl}/api/whatsapp/webhook/status`,
      });
      return prisma.whatsappMessage.create({
        data: {
          tenantId: vehicle.tenantId, vehicleId: vehicle.id, clientId: client.id,
          evento, testo, telefono: numero, stato: "INVIATO",
          providerMessageSid: msg.sid, inviatoDaId,
        },
      });
    } catch (err) {
      console.error(`[whatsapp] Errore invio a ${numero} (evento ${evento}):`, err.message);
      return prisma.whatsappMessage.create({
        data: {
          tenantId: vehicle.tenantId, vehicleId: vehicle.id, clientId: client.id,
          evento, testo, telefono: numero, stato: "FALLITO",
          errore: err.message?.slice(0, 500), inviatoDaId,
        },
      });
    }
  } catch (err) {
    console.error("[whatsapp] Errore imprevisto in inviaComunicazioneWhatsapp:", err);
    return null;
  }
}

export { renderTemplate, normalizzaNumero, VARIABILI };
