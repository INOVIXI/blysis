import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { answersFor } from "../../lib/fields";
import { fieldsOf, mayOpenIn } from "../../lib/departments";
import { isRestrictedFrom } from "@/core/sdk/server";
import { pageParams, hasPermission, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ticketSchema } from "../../lib/validations";
import { readTicketStates } from "../../lib/read-states";
import { DEFAULT_PRIORITY } from "../../lib/ticket-states";

// GET /api/v1/tickets - List tickets
export async function GET(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    /*
     * The column is a plain string now, so an unknown filter is no longer a
     * 500 out of `findMany` - it is a search that finds nothing. It is still
     * checked against the desk's own states, because a filter for a status
     * this desk does not have is a mistake worth saying out loud rather than
     * an empty list.
     */
    const { statuses, priorities } = await readTicketStates();
    const asked = searchParams.get("status");
    if (asked && !statuses.some((state) => state.key === asked)) {
        return NextResponse.json({ error: "Unknown status", code: "unknown_status" }, { status: 400 });
    }
    const status = asked;
    const departmentId = searchParams.get("departmentId");
    const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: 10 });

    const adminCheck = await hasPermission(session.user.id, "tickets.manage");

    // Build where clause
    const where: Record<string, unknown> = {};

    // Non-admin users can only see their own tickets
    if (!adminCheck) {
        where.userId = session.user.id;
    }

    if (status) {
        where.status = status;
    }

    if (departmentId) {
        where.departmentId = departmentId;
    }

    const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
            where,
            skip,
            take,
            orderBy: { updatedAt: "desc" },
            include: {
                department: { select: { id: true, name: true, color: true } },
                user: { select: { id: true, username: true, avatar: true } },
                assignedTo: { select: { id: true, username: true, avatar: true } },
                _count: { select: { messages: true } },
            },
        }),
        prisma.ticket.count({ where }),
    ]);

    return NextResponse.json({
        tickets,
        /*
         * The words a screen needs to draw these, with the tickets rather
         * than from a second request. A member reading their own tickets
         * cannot ask the admin endpoint for them, and a state an operator
         * added has no key in any catalogue - only the row knows its name.
         */
        states: { statuses, priorities },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
}

// POST /api/v1/tickets - Create a new ticket
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimitForRole(
        `ticket-create:${session.user.id}`,
        { maxRequests: 5, windowMs: 3_600_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = ticketSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { subject, message, departmentId, priority } = validation.data;

    // A priority this desk does not have is refused rather than written: the
    // column is a plain string now, so nothing below would catch it.
    const { priorities } = await readTicketStates();
    if (priority && !priorities.some((one) => one.key === priority)) {
        return NextResponse.json({ error: "Unknown priority", code: "unknown_priority" }, { status: 400 });
    }

    // Verify department exists
    const department = await prisma.ticketDepartment.findUnique({
        where: { id: departmentId },
    });

    if (!department) {
        return NextResponse.json(
            { error: "Department not found" },
            { status: 404 }
        );
    }

    // Kept out of the support desk, without being kept off the site. Asked
    // by this module's own word: core stores the scope and never reads it.
    if (await isRestrictedFrom(session.user.id, "tickets")) {
        return NextResponse.json(
            { error: "You cannot open a ticket at the moment", code: "restricted_from_tickets" },
            { status: 403 },
        );
    }

    // Not found rather than forbidden: a department this member may not open
    // is one they should not learn is there, and the picker in front of this
    // never offered it.
    if (!(await mayOpenIn(departmentId, session.user.role ?? null))) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    /*
     * The extra questions this department asks, answered. Checked here rather
     * than trusted from the form: a form posts keys and a request is not a
     * form, so an answer to a question this department does not ask is
     * dropped and a required one that is missing stops the ticket by name.
     */
    const asked = await fieldsOf(departmentId);
    const answered = answersFor(asked, (validation.data.fields ?? {}) as Record<string, unknown>);
    if ("missing" in answered) {
        return NextResponse.json(
            { error: "Some answers are missing", code: "ticket_fields_missing", missing: answered.missing },
            { status: 400 },
        );
    }
    if ("notOnTheList" in answered) {
        return NextResponse.json(
            { error: "That is not one of the answers", code: "ticket_field_not_on_list", field: answered.notOnTheList },
            { status: 400 },
        );
    }

    // Create ticket with initial message
    const ticket = await prisma.ticket.create({
        data: {
            subject,
            priority: priority || DEFAULT_PRIORITY,
            departmentId,
            // With the label each question had when it was asked, so renaming
            // or deleting a field later does not rewrite an old ticket.
            fieldAnswers: answered.answers.length > 0
                ? (answered.answers as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            userId: session.user.id,
            messages: {
                create: {
                    content: message,
                    userId: session.user.id,
                    isStaffReply: false,
                },
            },
        },
        include: {
            department: { select: { id: true, name: true, color: true } },
            user: { select: { id: true, username: true, avatar: true } },
            messages: {
                include: {
                    user: { select: { id: true, username: true, avatar: true } },
                },
            },
        },
    });

    // Discord notification

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("tickets.ticket.opened", ticket);

    // Private activity feed entry (only visible to actor)
    await prisma.activityFeedItem.create({
        data: {
            type: "tickets.ticket.opened",
            actorId: session.user.id,
            title: `Opened ticket: ${ticket.subject}`,
            href: `/tickets/${ticket.id}`,
            icon: "Ticket",
            isPublic: false,
        },
    }).catch(() => {});

    return NextResponse.json(ticket, { status: 201 });
}
