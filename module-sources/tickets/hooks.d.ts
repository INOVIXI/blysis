/**
 * Payload contract for the hooks this module fires. See blog/hooks.d.ts for
 * why the emitter owns these shapes and what widening/narrowing means.
 */
import type { AssistantReplyOutcome, TicketThread } from "./lib/assistant";

declare global {
    interface BlysisHookPayloads {
        "tickets.ticket.opened": TicketHookPayload;
        "tickets.ticket.updated": TicketHookPayload;
        "tickets.ticket.closed": TicketHookPayload;
        // `replied` is the odd one out: it carries the reply as well as the
        // ticket, so listeners can act on the message without a second query.
        // `byAssistant` marks a support assistant's message: it is neither the
        // member's nor staff's, and a listener that answers members must not
        // answer it.
        "tickets.ticket.replied": {
            ticket: TicketHookPayload;
            message: { id: string; content: string };
            isStaffReply: boolean;
            byAssistant?: boolean;
        };
        /** The member asked for a person instead of the assistant. */
        "tickets.ticket.handedOff": TicketHookPayload;
    }

    /**
     * What a support assistant may ask of this module, answered by the module
     * itself (lib/assistant.ts holds the rules). Nothing else about a ticket
     * is reachable this way: no state change, no closing, no staff reply.
     */
    interface BlysisFilterPayloads {
        "tickets.thread.read": TicketThread | null;
        "tickets.reply.post": AssistantReplyOutcome | null;
        "tickets.ticket.classify": { changed: ("department" | "priority")[] } | null;
        /** Departments and priorities, by the id a ticket stores and the name a reader reads. */
        "tickets.departments.list": { id: string; label: string }[];
        "tickets.priorities.list": { id: string; label: string }[];
    }

    interface BlysisFilterContexts {
        "tickets.thread.read": { ticketId: string };
        "tickets.reply.post": { ticketId: string; content: string; afterMessageId: string };
        "tickets.ticket.classify": { ticketId: string; departmentId?: string; priority?: string };
        "tickets.departments.list": { locale: string };
        "tickets.priorities.list": { locale: string };
    }
}

interface TicketHookPayload {
    id: string;
    subject: string;
    // Who opened it. Nullable, and not by accident: `user` is
    // `onDelete: SetNull`, so a ticket outlives the account that opened it and
    // a listener with news for its owner may have nobody to tell.
    userId: string | null;
    priority: string;
    user?: { username: string } | null;
    department?: { name: string } | null;
}

export {};
