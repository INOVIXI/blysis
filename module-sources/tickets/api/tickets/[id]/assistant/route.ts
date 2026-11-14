import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { setAssistantPaused } from "../../../../lib/assistant";

interface RouteParams {
    params: Promise<{ id: string }>;
}

const bodySchema = z.object({ paused: z.boolean() });

/**
 * POST /api/v1/tickets/[id]/assistant - stop a support assistant on a ticket,
 * or let it speak again.
 *
 * The member who opened the ticket may only stop it, which asks for a person;
 * the support team may do either. lib/assistant.ts holds the rule, and
 * anybody else gets the same 404 as a ticket that is not there.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimitForRoleAsync(
        `ticket-assistant:${session.user.id}`,
        { maxRequests: 10, windowMs: 60_000 },
        session.user.role,
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", code: "invalid", details: parsed.error.issues }, { status: 400 });
    }

    const { id } = await params;
    const outcome = await setAssistantPaused(id, session.user.id, parsed.data.paused);
    if (outcome === "not_found") {
        return NextResponse.json({ error: "Ticket not found", code: "not_found" }, { status: 404 });
    }
    if (outcome === "not_allowed") {
        return NextResponse.json({ error: "Only the support team can switch the assistant back on", code: "not_allowed" }, { status: 403 });
    }
    return NextResponse.json({ ok: true, paused: parsed.data.paused });
}
