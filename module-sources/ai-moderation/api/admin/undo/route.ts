/**
 * POST /api/v1/ai-moderation/admin/undo - take the reviewer's decisions back.
 *
 * Body: { ids: review ids, action: "approve" | "requeue" }. Approving
 * publishes the items; requeueing puts them in the queue for a person. Either
 * is the admin's own decision through core's `moderate`, recorded as theirs,
 * and an item already in that state is left as it is.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity, moderate, prisma, rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";

const bodySchema = z.object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(100),
    action: z.enum(["approve", "requeue"]),
});

export async function POST(request: NextRequest) {
    const session = await auth();
    const manager = await requireManager(session);
    if (manager instanceof NextResponse) return manager;
    // Each call may publish a hundred posts; a script looping on it should
    // meet a ceiling before it meets the whole queue.
    const allowed = await rateLimitForRoleAsync(`ai-moderation-undo:${manager.userId}`, { maxRequests: 60, windowMs: 60_000 }, session?.user?.role);
    if (!allowed) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid", code: "invalid" }, { status: 400 });
    }

    const reviews = await prisma.aiModerationReview.findMany({
        where: { id: { in: parsed.data.ids } },
        select: { provider: true, itemId: true },
    });
    const byKind = new Map<string, Set<string>>();
    for (const r of reviews) byKind.set(r.provider, (byKind.get(r.provider) ?? new Set()).add(r.itemId));

    const state = parsed.data.action === "approve" ? "APPROVED" : "PENDING";
    let affected = 0;
    for (const [kind, items] of byKind) {
        const result = await moderate({ kind, ids: [...items], state, decidedById: manager.userId });
        if (result.ok) affected += result.affected.length;
    }

    logActivity({
        userId: manager.userId,
        action: parsed.data.action === "approve" ? "ai-moderation.undo.approve" : "ai-moderation.undo.requeue",
        entity: "AiModerationReview",
        metadata: { reviews: parsed.data.ids.length, affected },
    }).catch(() => { });

    return NextResponse.json({ ok: true, affected });
}
