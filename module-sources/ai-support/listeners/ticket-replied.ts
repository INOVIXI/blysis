import { enqueue, forget } from "../lib/round";

/**
 * Hook listener: `tickets.ticket.replied`.
 *
 * A member writing asks for an answer. Staff writing means a person is on
 * the ticket, so a waiting answer is let go. The assistant's own message
 * asks for nothing: answering it would have the assistant talking to itself.
 */
export default async function onTicketReplied(payload: {
    ticket: { id: string };
    isStaffReply: boolean;
    byAssistant?: boolean;
}): Promise<void> {
    const ticketId = payload?.ticket?.id;
    if (!ticketId || payload.byAssistant) return;
    if (payload.isStaffReply) {
        await forget(ticketId);
        return;
    }
    await enqueue(ticketId);
}
