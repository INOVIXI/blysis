import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, rateLimitForRole, readJsonBody, rateLimitForRoleAsync } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ticketMessageSchema, ticketUpdateSchema } from "../../../lib/validations";
import { canAccessTicket } from "../../../lib/can-access-ticket";
import { ticketFieldsFor } from "../../../lib/ticket-edit-rights";
import { closesTicket, movedTo } from "../../../lib/ticket-states";
import { readTicketStates } from "../../../lib/read-states";

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/v1/tickets/[id] - Get ticket details
export async function GET(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: {
            department: { select: { id: true, name: true, color: true } },
            user: { select: { id: true, username: true, avatar: true } },
            assignedTo: { select: { id: true, username: true, avatar: true } },
            messages: {
                orderBy: { createdAt: "asc" },
                include: {
                    user: { select: { id: true, username: true, avatar: true } },
                },
            },
        },
    });

    if (!ticket) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check access - owner, tickets.manage role perm, or granular view grant.
    if (!(await canAccessTicket(session.user.id, id, "view"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    /*
     * The words this ticket's own states are called, with the ticket. A
     * member cannot ask the admin endpoint for them, and a state an operator
     * added has no key in any catalogue - only the row knows its name.
     */
    const { statuses, priorities } = await readTicketStates();
    return NextResponse.json({ ...ticket, states: { statuses, priorities } });
}

// POST /api/v1/tickets/[id] - Add a message/reply to ticket
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimitForRole(
        `ticket-reply:${session.user.id}`,
        { maxRequests: 10, windowMs: 60_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const ticket = await prisma.ticket.findUnique({
        where: { id },
    });

    if (!ticket) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check access - owner, tickets.manage role perm, or granular view grant
    // (granular viewers are allowed to post replies too).
    if (!(await canAccessTicket(session.user.id, id, "view"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const adminCheck = await hasPermission(session.user.id, "tickets.manage");

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = ticketMessageSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { content } = validation.data;

    // Create message and update ticket status
    const isStaffReply = adminCheck && ticket.userId !== session.user.id;

    const message = await prisma.ticketMessage.create({
        data: {
            content,
            ticketId: id,
            userId: session.user.id,
            isStaffReply,
        },
        include: {
            user: { select: { id: true, username: true, avatar: true } },
        },
    });

    // Update ticket status and timestamp.
    /*
     * Where a reply moves the ticket, asked of the desk's own states. A reply
     * to a finished ticket leaves it finished - one to a resolved ticket used
     * to reopen it, which surprised operators - and the two states the flow
     * names are looked up rather than written, so a desk that has taken
     * either away simply leaves the status alone.
     */
    const { statuses: replyStates } = await readTicketStates();
    const moved = movedTo(ticket.status, isStaffReply, replyStates);
    await prisma.ticket.update({
        where: { id },
        data: {
            ...(moved ? { status: moved } : {}),
            updatedAt: new Date(),
        },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("tickets.ticket.replied", { ticket, message, isStaffReply });

    // Private activity feed entry
    await prisma.activityFeedItem.create({
        data: {
            type: "tickets.ticket.replied",
            actorId: session.user.id,
            title: `Replied to ticket: ${ticket.subject}`,
            href: `/tickets/${ticket.id}`,
            icon: "Ticket",
            isPublic: false,
        },
    }).catch(() => {});

    return NextResponse.json(message, { status: 201 });
}

// PATCH /api/v1/tickets/[id] - Update ticket (admin, manage perm, granular edit)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimitForRoleAsync(
        `ticket-update:${session.user.id}`,
        { maxRequests: 30, windowMs: 60_000 },
        session.user.role
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    }

    // Check access - admin bypass, tickets.manage role perm, owner, or
    // granular edit grant.
    if (!(await canAccessTicket(session.user.id, id, "edit"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ticket = await prisma.ticket.findUnique({
        where: { id },
    });

    if (!ticket) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = ticketUpdateSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    // Being allowed to touch the ticket is not being allowed to write every
    // field on it. The owner passes the access check because they have to be
    // able to close their own; the queue's priority and who is responsible for
    // it are the support team's.
    const isStaff =
        (await hasPermission(session.user.id, "tickets.manage")) ||
        (await hasPermission(session.user.id, "tickets.manage"));
    const decision = ticketFieldsFor({ isStaff }, validation.data);

    /*
     * The desk's own states, asked once. A state this desk does not have is
     * refused here rather than written: the column is a plain string now, so
     * nothing below would have caught it.
     */
    const { statuses, priorities } = await readTicketStates();
    if (decision.allowed.status && !statuses.some((one) => one.key === decision.allowed.status)) {
        return NextResponse.json({ error: "Unknown status", code: "unknown_status" }, { status: 400 });
    }
    if (decision.allowed.priority && !priorities.some((one) => one.key === decision.allowed.priority)) {
        return NextResponse.json({ error: "Unknown priority", code: "unknown_priority" }, { status: 400 });
    }

    // An assignee has to actually be on the team. The column only requires a
    // real user, so a ticket could be handed to somebody with no way to open
    // it and no idea it was theirs.
    if (decision.allowed.assignedToId) {
        const assignee = decision.allowed.assignedToId;
        const staffAssignee =
            (await hasPermission(assignee, "tickets.manage")) || (await hasPermission(assignee, "tickets.manage"));
        if (!staffAssignee) {
            return NextResponse.json(
                { error: "That person is not on the support team", code: "assignee_not_staff" },
                { status: 400 },
            );
        }
    }

    // Nothing this caller may write, and something they asked for: say so
    // rather than answering 200 to a change that did not happen. A screen that
    // is told nothing shows the old value back and looks broken.
    if (Object.keys(decision.allowed).length === 0 && decision.refused.length > 0) {
        return NextResponse.json(
            { error: "Those fields belong to the support team", code: "not_yours_to_set", fields: decision.refused },
            { status: 403 },
        );
    }

    const updateData: Record<string, unknown> = {};
    if (decision.allowed.status) updateData.status = decision.allowed.status;
    if (decision.allowed.priority) updateData.priority = decision.allowed.priority;
    if (decision.allowed.assignedToId !== undefined) {
        updateData.assignedToId = decision.allowed.assignedToId;
    }

    /*
     * The day it was finished, stamped by the state rather than by two names.
     * This read `status === "CLOSED" || status === "RESOLVED"`, which is a
     * rule that cannot survive an operator renaming either, and one a desk
     * with a third finishing state could not extend.
     */
    if (decision.allowed.status && closesTicket(decision.allowed.status, statuses)) {
        updateData.closedAt = new Date();
    }

    const updated = await prisma.ticket.update({
        where: { id },
        data: updateData,
        include: {
            department: { select: { id: true, name: true, color: true } },
            user: { select: { id: true, username: true, avatar: true } },
            assignedTo: { select: { id: true, username: true, avatar: true } },
        },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("tickets.ticket.updated", updated);

    if (decision.allowed.status && closesTicket(decision.allowed.status, statuses)) {
        await doActionAsync("tickets.ticket.closed", updated);
    }

    // A partial write says which fields were dropped, so a screen sending
    // more than the caller owns can show what did not take.
    return NextResponse.json(
        decision.refused.length > 0 ? { ...updated, refused: decision.refused } : updated,
    );
}

// DELETE /api/v1/tickets/[id] - Delete ticket (admin only).
// Cascade-deletes the ticket's messages.
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "tickets.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

    await prisma.ticket.delete({ where: { id } });
    return NextResponse.json({ ok: true });
}
