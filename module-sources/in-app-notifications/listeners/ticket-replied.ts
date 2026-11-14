import { shouldNotify } from "@/core/sdk/server";
import { createNotification } from "../lib/notifications";

/**
 * Hook listener: `tickets.ticket.replied`.
 *
 * The tickets module declared this as something a person could be notified
 * about, and named it "Reply to your support ticket" in both languages, but
 * nothing listened: the row in the preferences grid was a switch on nothing.
 *
 * Only an answer is news to the person who opened the ticket - their own
 * reply is not. An answer is staff's or a support assistant's, and the
 * assistant's says so: a member must never read it as the team's. `userId` is
 * nullable, so the ticket may have outlived the account that opened it and
 * there is nobody left to tell.
 *
 * The link is the ticket's page as a member reads it, under /support; it used
 * to point at /tickets/<id>, which is no page at all.
 */
export default async function onTicketReplied(payload: {
    ticket: { id: string; subject: string; userId: string | null };
    isStaffReply: boolean;
    byAssistant?: boolean;
}): Promise<void> {
    const byAssistant = payload?.byAssistant === true;
    if (!payload?.isStaffReply && !byAssistant) return;
    const recipient = payload.ticket?.userId;
    if (!recipient) return;
    if (!(await shouldNotify(recipient, "tickets.ticket.replied", "inapp"))) return;
    const href = `/support/${payload.ticket.id}`;
    const params = { subject: payload.ticket.subject };
    if (byAssistant) {
        await createNotification({
            userId: recipient,
            title: "The assistant answered your ticket",
            message: `An AI assistant replied to "${payload.ticket.subject}". You can ask for a person there.`,
            titleKey: "notif_ticketAssistantTitle",
            messageKey: "notif_ticketAssistantMessage",
            params,
            type: "info",
            href,
        });
        return;
    }
    await createNotification({
        userId: recipient,
        title: "New reply on your ticket",
        message: `Support replied to "${payload.ticket.subject}".`,
        titleKey: "notif_ticketRepliedTitle",
        messageKey: "notif_ticketRepliedMessage",
        params,
        type: "info",
        href,
    });
}
