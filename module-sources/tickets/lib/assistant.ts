import { hasPermission, prisma } from "@/core/sdk/server";
import { readTicketStates } from "./read-states";
import { isOpenState } from "./ticket-states";

/**
 * What a support assistant may do to a ticket, which is little on purpose.
 *
 * Another module reaches these through the `tickets.*` filters this module
 * answers (see hooks.d.ts); it never writes the tables. It may read the
 * conversation, add one message that is marked as the assistant's and never
 * as staff's, and move a ticket between the departments and priorities the
 * desk has. It cannot close a ticket, change its state or speak where it was
 * stopped.
 *
 * `tests/modules/tickets/an-assistant-speaks-only-where-it-may.test.ts` holds
 * each rule.
 */

/** The longest message a reply may be, as a member's or staff's is. */
const MESSAGE_MAX = 20_000;

export type MessageAuthor = "member" | "staff" | "assistant";

export interface ThreadMessage {
    id: string;
    author: MessageAuthor;
    content: string;
    createdAt: Date;
}

export interface TicketThread {
    id: string;
    subject: string;
    status: string;
    isOpen: boolean;
    priority: string;
    departmentId: string;
    departmentName: string;
    userId: string | null;
    /** The language the member reads the site in, when the account is still there. */
    memberLocale: string | null;
    assistantPaused: boolean;
    messages: ThreadMessage[];
}

export type AssistantReplyOutcome =
    | { ok: true; messageId: string }
    | { ok: false; reason: "not_found" | "closed" | "paused" | "stale" | "empty" };

export type PauseOutcome = "ok" | "not_found" | "not_allowed";

function authorOf(message: { byAssistant?: boolean | null; isStaffReply: boolean }): MessageAuthor {
    if (message.byAssistant) return "assistant";
    return message.isStaffReply ? "staff" : "member";
}

export async function readThread(ticketId: string): Promise<TicketThread | null> {
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
            id: true, subject: true, status: true, priority: true, departmentId: true,
            userId: true, assistantPaused: true,
        },
    });
    if (!ticket) return null;
    const [department, member, messages, { statuses }] = await Promise.all([
        prisma.ticketDepartment.findUnique({ where: { id: ticket.departmentId }, select: { name: true } }),
        ticket.userId ? prisma.user.findUnique({ where: { id: ticket.userId }, select: { locale: true } }) : null,
        prisma.ticketMessage.findMany({
            where: { ticketId },
            orderBy: { createdAt: "asc" },
            select: { id: true, content: true, isStaffReply: true, byAssistant: true, createdAt: true },
        }),
        readTicketStates(),
    ]);
    return {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        isOpen: isOpenState(ticket.status, statuses),
        priority: ticket.priority,
        departmentId: ticket.departmentId,
        departmentName: department?.name ?? "",
        userId: ticket.userId,
        memberLocale: member?.locale ?? null,
        assistantPaused: ticket.assistantPaused,
        messages: messages.map((m) => ({ id: m.id, author: authorOf(m), content: m.content, createdAt: m.createdAt })),
    };
}

/**
 * Add the assistant's answer to the message it was written for.
 *
 * `afterMessageId` is the last message the assistant read. Anything said
 * since, by the member or by staff, makes the answer stale: it would reply
 * to a conversation that has moved on, or talk over a person.
 *
 * The ticket's state is left alone. An answer from the assistant is not one
 * from the team, so the ticket stays in the team's queue.
 */
export async function postAssistantReply(input: { ticketId: string; content: string; afterMessageId: string }): Promise<AssistantReplyOutcome> {
    const content = input.content.trim().slice(0, MESSAGE_MAX);
    if (!content) return { ok: false, reason: "empty" };

    const ticket = await prisma.ticket.findUnique({
        where: { id: input.ticketId },
        select: { id: true, subject: true, status: true, priority: true, userId: true, assistantPaused: true },
    });
    if (!ticket) return { ok: false, reason: "not_found" };
    const { statuses } = await readTicketStates();
    if (!isOpenState(ticket.status, statuses)) return { ok: false, reason: "closed" };
    if (ticket.assistantPaused) return { ok: false, reason: "paused" };

    const written = await prisma.$transaction(async (tx) => {
        const last = await tx.ticketMessage.findFirst({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (last?.id !== input.afterMessageId) return null;
        const message = await tx.ticketMessage.create({
            data: { content, ticketId: ticket.id, userId: null, isStaffReply: false, byAssistant: true },
            select: { id: true, content: true },
        });
        await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
        return message;
    });
    if (!written) return { ok: false, reason: "stale" };

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("tickets.ticket.replied", { ticket, message: written, isStaffReply: false, byAssistant: true });
    return { ok: true, messageId: written.id };
}

/**
 * Move a ticket to another department or priority the desk has.
 *
 * Anything the desk does not have, or has switched off, is ignored rather
 * than refused: the value came from a model, and a wrong guess should leave
 * the ticket where a person put it. A finished ticket is not re-sorted.
 */
export async function classifyTicket(input: { ticketId: string; departmentId?: string; priority?: string }): Promise<{ changed: ("department" | "priority")[] }> {
    const ticket = await prisma.ticket.findUnique({
        where: { id: input.ticketId },
        select: { id: true, status: true, priority: true, departmentId: true },
    });
    if (!ticket) return { changed: [] };
    const { statuses, priorities } = await readTicketStates();
    if (!isOpenState(ticket.status, statuses)) return { changed: [] };

    const data: { departmentId?: string; priority?: string } = {};
    const changed: ("department" | "priority")[] = [];
    if (input.departmentId && input.departmentId !== ticket.departmentId) {
        const department = await prisma.ticketDepartment.findUnique({ where: { id: input.departmentId }, select: { isActive: true } });
        if (department?.isActive) {
            data.departmentId = input.departmentId;
            changed.push("department");
        }
    }
    if (input.priority && input.priority !== ticket.priority && priorities.some((p) => p.key === input.priority)) {
        data.priority = input.priority;
        changed.push("priority");
    }
    if (changed.length === 0) return { changed };

    const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data,
        select: { id: true, subject: true, userId: true, priority: true },
    });
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("tickets.ticket.updated", updated);
    return { changed };
}

/**
 * Stop the assistant on a ticket, or let it speak again.
 *
 * The member who opened the ticket may stop it, which is asking for a person:
 * the moment is stamped and announced so the team can see it. Letting it speak
 * again is the team's, and doing so answers that request. Anybody else is told
 * the ticket is not there, as a ticket they cannot open would be.
 */
export async function setAssistantPaused(ticketId: string, userId: string, paused: boolean): Promise<PauseOutcome> {
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, subject: true, userId: true, priority: true },
    });
    if (!ticket) return "not_found";
    const isStaff = await hasPermission(userId, "tickets.manage");
    const isOwner = ticket.userId === userId;
    if (!isStaff && !isOwner) return "not_found";
    if (!isStaff && !paused) return "not_allowed";

    const askedByMember = !isStaff && paused;
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assistantPaused: paused, askedForPersonAt: askedByMember ? new Date() : null },
    });
    if (askedByMember) {
        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("tickets.ticket.handedOff", ticket);
    }
    return "ok";
}
