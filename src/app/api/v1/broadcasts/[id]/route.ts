import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { queueBroadcast } from "@/core/lib/broadcasts";
import { prismaErrorOrThrow } from "@/core/lib/prisma-errors";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const broadcast = await prisma.emailBroadcast.findUnique({ where: { id } });
    if (!broadcast) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ broadcast });
}

/**
 * PATCH - correct a draft.
 *
 * The screen could save a draft and could send one, and had no way to open it
 * again: there was nothing here that changed a subject or a body. A message
 * you wrote once, can read, can send and can never correct is a worse thing
 * than no draft at all, because saving one feels like keeping your work.
 *
 * Only a draft. Once it is queued the sender is walking the list, and
 * rewriting the body underneath it would send two different messages to two
 * halves of the site; once it is sent it is a record of what went out, and a
 * record that can be edited is not one.
 */
const editSchema = z.object({
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(100_000).optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = editSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { id } = await params;
    const existing = await prisma.emailBroadcast.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "draft") {
        return NextResponse.json(
            { error: "Only a draft can be edited", code: "broadcast_not_a_draft" },
            { status: 409 },
        );
    }

    const data: { subject?: string; body?: string } = {};
    if (parsed.data.subject !== undefined) data.subject = parsed.data.subject;
    if (parsed.data.body !== undefined) data.body = parsed.data.body;
    if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }

    const broadcast = await prisma.emailBroadcast.update({ where: { id }, data });
    return NextResponse.json({ broadcast });
}

/** POST → queue this broadcast (transitions draft → queued) */
export async function POST(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const result = await queueBroadcast(id);
    return NextResponse.json(result);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    try {
        await prisma.emailBroadcast.delete({ where: { id } });
    } catch (err) {
        // Deleting a broadcast that is already gone is a 404, not a 500.
        return prismaErrorOrThrow(err);
    }
    return NextResponse.json({ ok: true });
}
