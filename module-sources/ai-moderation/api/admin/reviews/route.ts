/**
 * GET /api/v1/ai-moderation/admin/reviews - what the AI reviewer decided,
 * newest first.
 *
 * Narrowed by what it answered (`applied`, or `error` for the calls that
 * failed), by kind, and by the last `days` days. Rows carry ids, not labels:
 * the screen already holds the kinds and reasons in the reader's language.
 */
import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { APPLIED, requireManager } from "../../../lib/admin";

const OUTCOMES = [...APPLIED, "error"] as const;
const MAX_DAYS = 3650;

export async function GET(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const params = request.nextUrl.searchParams;
    const { page, limit, skip } = pageParams(params, { defaultLimit: 50 });
    const outcome = params.get("applied") ?? "";
    if (outcome && !(OUTCOMES as readonly string[]).includes(outcome)) {
        return NextResponse.json({ error: "Unknown filter", code: "invalid_filter" }, { status: 400 });
    }
    const kind = (params.get("kind") ?? "").slice(0, 64);
    const days = Math.min(MAX_DAYS, Math.max(0, Math.floor(Number(params.get("days") ?? 0)) || 0));

    const where = {
        ...(outcome === "error" ? { verdict: "error" } : outcome ? { applied: outcome, verdict: { not: "error" } } : {}),
        ...(kind ? { provider: kind } : {}),
        ...(days > 0 ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}),
    };

    const [reviews, total] = await Promise.all([
        prisma.aiModerationReview.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true, provider: true, itemId: true, verdict: true, applied: true, reasonId: true,
                confidence: true, rationale: true, error: true, createdAt: true,
            },
        }),
        prisma.aiModerationReview.count({ where }),
    ]);

    return NextResponse.json({ reviews, total, page, limit });
}
