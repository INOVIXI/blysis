/**
 * GET /api/v1/ai-support/admin/drafts - what the assistant drafted and sent,
 * newest first, for the managers' record. `?status=` narrows it to one kind.
 */
import { NextRequest, NextResponse } from "next/server";
import { enumParam, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { DRAFT_STATUSES, MANAGE, requireAny } from "../../../lib/admin";

export async function GET(request: NextRequest) {
    const session = await auth();
    const manager = await requireAny(session, [MANAGE]);
    if (manager instanceof NextResponse) return manager;

    const query = new URL(request.url).searchParams;
    const { page, limit, skip } = pageParams(query);
    const status = enumParam(query, "status", DRAFT_STATUSES);
    if (status instanceof NextResponse) return status;
    const where = status ? { status } : {};
    const [drafts, total] = await Promise.all([
        prisma.aiSupportDraft.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true, ticketId: true, status: true, reply: true, canAnswer: true, confidence: true,
                error: true, createdAt: true,
            },
        }),
        prisma.aiSupportDraft.count({ where }),
    ]);
    return NextResponse.json({ drafts, total, page, limit });
}
