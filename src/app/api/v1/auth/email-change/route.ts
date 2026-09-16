import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmEmailChange } from "@/core/lib/email-change";
import { readJsonBody } from "@/core/lib/api-body";
import { getClientIP, rateLimit } from "@/core/lib/rate-limit";

/**
 * Answering the link that moves an account to a new address.
 *
 * No session. The person clicking is proving they hold the mailbox, and
 * requiring them to be signed in as well would break the ordinary case: the
 * link is opened on a phone, in a mail client, hours later.
 *
 * That makes the token the whole authorisation, so it is rate limited by
 * address: a token is 32 random bytes and guessing one is not a thing anybody
 * does, but a flood of attempts is still a flood.
 */
const bodySchema = z.object({ token: z.string().min(16).max(256) });

export async function POST(request: NextRequest) {
    const limit = await rateLimit(`email-change-confirm:${getClientIP(request.headers)}`, {
        maxRequests: 10,
        windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
        return NextResponse.json({ error: "Too many attempts", code: "rate_limited" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid token", code: "token_invalid" }, { status: 400 });
    }

    const outcome = await confirmEmailChange(parsed.data.token);
    if (!outcome.ok) {
        return NextResponse.json({ error: "Not confirmed", code: outcome.code }, { status: 400 });
    }

    return NextResponse.json({ message: "Address confirmed" });
}
