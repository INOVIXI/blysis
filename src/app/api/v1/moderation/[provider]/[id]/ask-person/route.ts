import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { rateLimit, getClientIP } from "@/core/lib/rate-limit";
import { askPerson } from "@/core/lib/moderation-ask-person";
import { logActivity } from "@/core/lib/activity-log";
import { errorText, log } from "@/core/lib/logger";

/**
 * POST /api/v1/moderation/[provider]/[id]/ask-person
 *
 * The author of something a reviewing module rejected asks a person to look
 * at it. Not found for anybody else and for an item that does not exist, so
 * the answer says nothing about what somebody else wrote; `not_allowed` when
 * the rejection was a person's or the author already asked. See
 * `src/core/lib/moderation-ask-person.ts`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string; id: string }> }) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // Per member: each ask is a read of the item and a write to the queue,
    // and nobody has a reason to press it more than a handful of times.
    const limited = await rateLimit(`moderation-ask-person:${userId}`, { maxRequests: 10, windowMs: 60 * 60 * 1000 });
    if (!limited.success) {
        return NextResponse.json({ error: "Too many requests. Try again later.", code: "rate_limited" }, { status: 429 });
    }

    const { provider, id } = await params;
    let result: Awaited<ReturnType<typeof askPerson>>;
    try {
        result = await askPerson(provider, id, userId);
    } catch (err) {
        log.error("[moderation] asking a person failed", { provider, error: errorText(err) });
        return NextResponse.json({ error: "Operation failed", code: "failed" }, { status: 500 });
    }

    if (result === "not_found") {
        return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
    }
    if (result === "not_allowed") {
        return NextResponse.json({ error: "A person can no longer be asked about this", code: "not_allowed" }, { status: 409 });
    }

    logActivity({
        userId,
        action: "moderation.ask_person",
        entity: provider,
        entityId: id,
        ipAddress: getClientIP(request.headers),
    }).catch(() => { });

    return NextResponse.json({ ok: true });
}
