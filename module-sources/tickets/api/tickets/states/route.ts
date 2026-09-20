import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { STATE_TONES, nextStateOrder } from "../../../lib/ticket-states";
import { readTicketStates } from "../../../lib/read-states";

/**
 * The states this desk names its tickets with.
 *
 * Statuses and priorities at one address because they are one question an
 * operator asks once - "what states does this desk have" - and one screen
 * answers it. `?kind=` says which list a write is about.
 *
 * Admin, all of it. A visitor needs the words to read their own ticket and
 * gets them with the ticket, from the server that rendered it.
 */

const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const createSchema = z.object({
    kind: z.enum(["status", "priority"]),
    key: z.string().min(1).max(32).regex(KEY, "a key is letters, digits, hyphens and underscores"),
    name: z.string().trim().min(1).max(64),
    tone: z.enum(STATE_TONES),
    isOpen: z.boolean().optional(),
    closesTicket: z.boolean().optional(),
});

const updateSchema = z.object({
    kind: z.enum(["status", "priority"]),
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(64).optional(),
    tone: z.enum(STATE_TONES).optional(),
    isOpen: z.boolean().optional(),
    closesTicket: z.boolean().optional(),
});

const removeSchema = z.object({
    kind: z.enum(["status", "priority"]),
    id: z.string().min(1).max(64),
});

async function requireAdmin(): Promise<string | NextResponse> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "tickets.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return session.user.id;
}

export async function GET() {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;
    return NextResponse.json(await readTicketStates());
}

export async function POST(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { kind, key, name, tone, isOpen, closesTicket } = parsed.data;

    // A key already in use would take over every ticket holding it, which is
    // a rename nobody asked for.
    const taken = kind === "status"
        ? await prisma.ticketStatus.findUnique({ where: { key } })
        : await prisma.ticketPriority.findUnique({ where: { key } });
    if (taken) {
        return NextResponse.json({ error: "That key is taken", code: "key_taken" }, { status: 409 });
    }

    // After the ones already there: the column defaults to zero and the
    // seeded states sit at ten upwards, so a new one landed above all of them.
    const highest = kind === "status"
        ? await prisma.ticketStatus.findFirst({ orderBy: { order: "desc" }, select: { order: true } })
        : await prisma.ticketPriority.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
    const order = nextStateOrder(highest?.order ?? null);

    const state = kind === "status"
        ? await prisma.ticketStatus.create({
            data: { key, name, tone, order, isOpen: isOpen ?? true, closesTicket: closesTicket ?? false },
        })
        : await prisma.ticketPriority.create({ data: { key, name, tone, order } });

    await logActivity({
        userId: who,
        action: `ticket_${kind}.create`,
        entity: kind === "status" ? "TicketStatus" : "TicketPriority",
        entityId: state.id,
        metadata: { key },
    });
    return NextResponse.json({ state }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { kind, id, name, tone, isOpen, closesTicket } = parsed.data;

    // A name an operator types replaces the key this module translated it
    // under: once they have said what it is called, that is what it is
    // called, in every language.
    const data: Record<string, unknown> = {};
    if (name !== undefined) { data.name = name; data.nameKey = null; }
    if (tone !== undefined) data.tone = tone;
    if (kind === "status") {
        if (isOpen !== undefined) data.isOpen = isOpen;
        if (closesTicket !== undefined) data.closesTicket = closesTicket;
    }

    const state = kind === "status"
        ? await prisma.ticketStatus.update({ where: { id }, data })
        : await prisma.ticketPriority.update({ where: { id }, data });

    await logActivity({
        userId: who,
        action: `ticket_${kind}.update`,
        entity: kind === "status" ? "TicketStatus" : "TicketPriority",
        entityId: id,
        metadata: { key: state.key, fields: Object.keys(data) },
    });
    return NextResponse.json({ state });
}

export async function DELETE(request: NextRequest) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = removeSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { kind, id } = parsed.data;

    const state = kind === "status"
        ? await prisma.ticketStatus.findUnique({ where: { id } })
        : await prisma.ticketPriority.findUnique({ where: { id } });
    if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });

    /*
     * A ticket keeps the key it holds. Nothing points at the row, so taking a
     * state away leaves the tickets that were in it holding a word nothing
     * names - which the label falls back to printing as it stands, and which
     * is what a ticket in a state that has been retired should read as.
     *
     * The count is reported so an operator knows what they are about to
     * leave behind.
     */
    const holding = await prisma.ticket.count({
        where: kind === "status" ? { status: state.key } : { priority: state.key },
    });

    if (kind === "status") await prisma.ticketStatus.delete({ where: { id } });
    else await prisma.ticketPriority.delete({ where: { id } });

    await logActivity({
        userId: who,
        action: `ticket_${kind}.delete`,
        entity: kind === "status" ? "TicketStatus" : "TicketPriority",
        entityId: id,
        metadata: { key: state.key, ticketsLeftHolding: holding },
    });
    return NextResponse.json({ ok: true, ticketsLeftHolding: holding });
}
