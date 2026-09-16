// Punto 36 del prompt SaaS ("FAQ"): popola le 8 domande richieste
// esplicitamente dal prompt con risposte verificate contro il
// comportamento reale del sistema (non testo di marketing generico) —
// vedi il commit di questo punto per il dettaglio di come ogni singola
// risposta è stata verificata nel codice.
//
// Idempotente: se la tabella ha già righe (perché il super-admin ha
// già modificato/aggiunto FAQ, punto 36 "FAQ modificabile"), non fa
// nulla — non è pensato per essere rieseguito per "resettare" i
// contenuti, solo per popolarli la prima volta.

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const FAQ = [
  {
    domanda: "Posso provarlo?",
    risposta: "Sì. Alla registrazione parte automaticamente una prova gratuita di 30 giorni con le funzionalità del piano PRO, senza bisogno di inserire una carta di credito.",
  },
  {
    domanda: "Posso cambiare piano?",
    risposta: "Sì, in qualsiasi momento dall'area di fatturazione del gestionale. Il downgrade viene bloccato se hai più utenti attivi di quanti ne includa il nuovo piano: in quel caso va prima ridotto il numero di utenti.",
  },
  {
    domanda: "I miei dati sono separati?",
    risposta: "Sì. Ogni carrozzeria è un tenant isolato: i dati sono sempre filtrati per tenant a livello di applicazione, con un ulteriore livello di isolamento indipendente (Row Level Security) applicato direttamente dal database.",
  },
  {
    domanda: "Posso invitare dipendenti?",
    risposta: "Sì. Un amministratore può aggiungere collaboratori dal gestionale assegnando un ruolo (tecnico, accettatore, amministrazione) e le relative credenziali di accesso. Il numero di utenti inclusi dipende dal piano scelto.",
  },
  {
    domanda: "Posso usarlo da smartphone?",
    risposta: "Sì, l'interfaccia è responsive ed è stata verificata su schermi da smartphone e tablet, non solo da computer.",
  },
  {
    domanda: "Come funziona la fatturazione?",
    risposta: "L'abbonamento è mensile o annuale a seconda del piano scelto, gestito tramite Stripe. Metodo di pagamento, fatture e rinnovo si gestiscono in autonomia dall'area di fatturazione del gestionale.",
  },
  {
    domanda: "Posso annullare?",
    risposta: "Sì. Una volta attivato un abbonamento, puoi annullarlo in autonomia dall'area di fatturazione (portale Stripe). Se sei ancora nella prova gratuita, ti basta non attivare un piano: la prova si conclude semplicemente alla scadenza, senza alcun addebito.",
  },
  {
    domanda: "Cosa succede ai dati?",
    risposta: "Alla scadenza della prova o alla cancellazione dell'abbonamento l'accesso viene bloccato ma i dati restano conservati, non vengono cancellati automaticamente. Puoi richiedere in qualsiasi momento l'esportazione completa dei tuoi dati o la cancellazione definitiva dell'account dalla sezione privacy del gestionale.",
  },
];

async function main() {
  const esistenti = await prisma.faqItem.count();
  if (esistenti > 0) {
    console.log(`La tabella FAQ ha già ${esistenti} voci: nessuna modifica (script pensato solo per il primo popolamento).`);
    return;
  }
  for (let i = 0; i < FAQ.length; i++) {
    await prisma.faqItem.create({ data: { ...FAQ[i], ordine: i } });
  }
  console.log(`Create ${FAQ.length} voci FAQ.`);
}

main()
  .catch((err) => {
    console.error("Errore:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
