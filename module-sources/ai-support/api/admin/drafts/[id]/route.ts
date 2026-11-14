/**
 * PATCH /api/v1/ai-support/admin/drafts/[id] - say what became of a draft.
 *
 * Body: { status: "used" | "discarded" }. "used" is staff putting it in their
 * reply box, "discarded" is staff setting it aside; either takes it off the
 * ticket's screen. Only a draft still waiting may change, so the record of
 * what was sent is never rewritten.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { MANAGE, USE, requireAny } from "../../../../lib/admin";

interface RouteParams {
    params: Promise<{ id: string }>;
}

const bodySchema = z.object({ status: z.enum(["used", "discarded"]) });

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const staff = await requireAny(session, [USE, MANAGE]);
    if (staff instanceof NextResponse) return staff;
    const allowed = await rateLimitForRoleAsync(`ai-support-draft:${staff.userId}`, { maxRequests: 60, windowMs: 60_000 }, session?.user?.role);
    if (!allowed) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid", code: "invalid" }, { status: 400 });
    }

    const { id } = await params;
    const changed = await prisma.aiSupportDraft.updateMany({
        where: { id, status: { in: ["draft", "failed"] } },
        data: { status: parsed.data.status },
    });
    if (changed.count === 0) {
        return NextResponse.json({ error: "That draft is not waiting any more", code: "not_waiting" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: parsed.data.status });
}
