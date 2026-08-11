import { Resend } from "resend";
import twilio from "twilio";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

// Messaggi personalizzati per ogni stato che vogliamo comunicare al cliente.
// Gli stati non presenti in questa mappa NON generano notifiche (es. passaggi
// puramente interni come ORDINE_RICAMBI, LUCIDATURA, ecc.)
const MESSAGGI_STAGE = {
  ATTESA_APPROVAZIONE: (v) =>
    `Ciao ${v.clientNome}, il preventivo per la tua ${v.marca} ${v.modello} (targa ${v.targa}) è pronto. Ti contatteremo a breve per l'approvazione.`,
  IN_LAVORAZIONE: (v) =>
    `Ciao ${v.clientNome}, la lavorazione della tua ${v.marca} ${v.modello} (targa ${v.targa}) è iniziata.`,
  PRONTA_CONSEGNA: (v) =>
    `Ciao ${v.clientNome}, la tua ${v.marca} ${v.modello} (targa ${v.targa}) è pronta per il ritiro!`,
  CONSEGNATA: (v) =>
    `Ciao ${v.clientNome}, grazie per aver scelto la nostra carrozzeria per la tua ${v.marca} ${v.modello}. Alla prossima!`,
};

const OGGETTO_EMAIL = {
  ATTESA_APPROVAZIONE: "Preventivo pronto",
  IN_LAVORAZIONE: "Lavorazione iniziata",
  PRONTA_CONSEGNA: "Auto pronta per il ritiro",
  CONSEGNATA: "Consegna completata",
};

/**
 * Invia una notifica email + WhatsApp al cliente quando il veicolo
 * cambia stato, solo per gli stati presenti in MESSAGGI_STAGE.
 *
 * @param {object} vehicle - il veicolo aggiornato, con relazione client inclusa
 * @param {string} newStage - il nuovo stato (es. "PRONTA_CONSEGNA")
 */
export async function enqueueNotification(vehicle, newStage) {
  const template = MESSAGGI_STAGE[newStage];
  if (!template) return; // stato non "comunicabile" al cliente, nessuna notifica

  const client = vehicle.client;
  if (!client) {
    console.warn(`[notifiche] Veicolo ${vehicle.id}: nessun cliente collegato, salto notifica`);
    return;
  }

  const testo = template({
    clientNome: client.nome,
    marca: vehicle.marca,
    modello: vehicle.modello,
    targa: vehicle.targa,
  });

  // --- EMAIL ---
  if (client.email && resend) {
    try {
  const { data, error } = await resend.emails.send({
    from: "Ombra CRM <onboarding@resend.dev>", // da sostituire con dominio verificato quando disponibile
    to: client.email,
    subject: OGGETTO_EMAIL[newStage] || "Aggiornamento veicolo",
    text: testo,
  });
  if (error) {
    console.error(`[notifiche] Errore invio email a ${client.email}:`, JSON.stringify(error));
  } else {
    console.log(`[notifiche] Email inviata a ${client.email} (stage ${newStage}), id: ${data?.id}`);
  }
} catch (err) {
  console.error(`[notifiche] Errore invio email a ${client.email}:`, err.message);
}
  }

  // --- WHATSAPP ---
  if (client.telefono && twilioClient && process.env.TWILIO_WHATSAPP_NUMBER) {
    try {
      // Normalizza il numero: deve essere in formato internazionale (es. +393331234567)
      const numero = client.telefono.startsWith("+") ? client.telefono : `+39${client.telefono.replace(/\D/g, "")}`;
  await twilioClient.messages.create({
  from: process.env.TWILIO_WHATSAPP_NUMBER,
  to: `whatsapp:${numero}`,
  contentSid: "HXd35dced652dac1e2a55e7838bed5aff0",
  contentVariables: JSON.stringify({ "1": testo }),
});
      console.log(`[notifiche] WhatsApp inviato a ${numero} (stage ${newStage})`);
    } catch (err) {
      console.error(`[notifiche] Errore invio WhatsApp a ${client.telefono}:`, err.message);
    }
  }
}