import { enqueue } from "../lib/round";

/**
 * Hook listener: `tickets.ticket.opened`. A new ticket asks for an answer.
 * Only a job is written here; whether and how it is answered is the round's
 * to decide, a minute from now at most.
 */
export default async function onTicketOpened(ticket: { id: string }): Promise<void> {
    if (!ticket?.id) return;
    await enqueue(ticket.id);
}
