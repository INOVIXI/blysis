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
import { logActivity, moderate, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";

const bodySchema = z.object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(100),
    action: z.enum(["approve", "requeue"]),
});

export async function POST(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

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
        action: `ai-moderation.undo.${parsed.data.action}`,
        entity: "AiModerationReview",
        metadata: { reviews: parsed.data.ids.length, affected },
    }).catch(() => { });

    return NextResponse.json({ ok: true, affected });
}
