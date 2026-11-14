/**
 * GET /api/v1/ai-support/tickets/[ticketId]/draft - the assistant's answer to
 * the member's last message on a ticket, for the ticket's screen.
 *
 * Only an answer to the last message counts: once anybody has spoken since,
 * the draft answers a conversation that moved on and is not shown. A
 * suggested department or priority is named in `?locale=`.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { MANAGE, USE, requireAny } from "../../../../lib/admin";
import { departments, priorities, readThread } from "../../../../lib/desk";

interface RouteParams {
    params: Promise<{ ticketId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const staff = await requireAny(session, [USE, MANAGE]);
    if (staff instanceof NextResponse) return staff;

    const { ticketId } = await params;
    const thread = await readThread(ticketId);
    if (!thread) return NextResponse.json({ error: "Ticket not found", code: "not_found" }, { status: 404 });
    const last = thread.messages[thread.messages.length - 1];
    if (!last || last.author !== "member") return NextResponse.json({ draft: null });

    const draft = await prisma.aiSupportDraft.findFirst({
        where: { ticketId, afterMessageId: last.id, status: { in: ["draft", "failed"] } },
        select: {
            id: true, status: true, reply: true, canAnswer: true, confidence: true, sources: true,
            departmentId: true, priority: true, error: true, createdAt: true,
        },
    });
    if (!draft) return NextResponse.json({ draft: null });

    const locale = (new URL(request.url).searchParams.get("locale") ?? "").slice(0, 16);
    const [deskDepartments, deskPriorities] = await Promise.all([
        draft.departmentId ? departments(locale) : [],
        draft.priority ? priorities(locale) : [],
    ]);
    return NextResponse.json({
        draft: {
            ...draft,
            departmentLabel: deskDepartments.find((d) => d.id === draft.departmentId)?.label ?? null,
            priorityLabel: deskPriorities.find((p) => p.id === draft.priority)?.label ?? null,
        },
    });
}
