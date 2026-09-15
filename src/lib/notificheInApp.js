import { prisma } from "./prisma.js";

// Una notifica è "personale": crearne una per più destinatari significa
// scrivere una riga per ciascuno, così "segna come letta" riguarda solo
// chi l'ha effettivamente letta, mai l'evento condiviso.

export async function creaNotificaUtente({ tenantId, userId, categoria, titolo, messaggio, link }) {
  return prisma.notification.create({
    data: { tenantId, userId, categoria, titolo, messaggio, link: link ?? undefined },
  });
}

export async function creaNotificaUtenti({ tenantId, userIds, categoria, titolo, messaggio, link }) {
  const destinatari = [...new Set(userIds)];
  if (destinatari.length === 0) return { count: 0 };
  return prisma.notification.createMany({
    data: destinatari.map((userId) => ({ tenantId, userId, categoria, titolo, messaggio, link: link ?? undefined })),
  });
}

// Invia a tutti gli utenti attivi del tenant che hanno uno dei ruoli
// indicati — usato per eventi rilevanti per chi gestisce (ADMIN,
// AMMINISTRAZIONE), non per il singolo utente che ha generato l'evento.
export async function creaNotificaRuoli({ tenantId, ruoli, categoria, titolo, messaggio, link, escludiUserId }) {
  const utenti = await prisma.user.findMany({
    where: {
      tenantId,
      attivo: true,
      ruolo: { in: ruoli },
      ...(escludiUserId ? { id: { not: escludiUserId } } : {}),
    },
    select: { id: true },
  });
  return creaNotificaUtenti({ tenantId, userIds: utenti.map((u) => u.id), categoria, titolo, messaggio, link });
}
