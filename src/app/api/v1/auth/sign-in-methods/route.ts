import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { readJsonBody } from "@/core/lib/api-body";
import { rateLimitForRoleAsync } from "@/core/lib/rate-limit";
import { callerSessionTokenId } from "@/core/lib/session-registry";
import {
    connectableProviders,
    signInMethodsOf,
    startConnect,
} from "@/core/lib/sign-in-methods";

/**
 * GET - the member's own sign-in methods, and which providers they could
 * connect. The provider's tokens never leave the server: the account page
 * shows a name, an id and a date, and nothing it draws needs more.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });

    const [methods, connectable] = await Promise.all([
        signInMethodsOf(session.user.id),
        connectableProviders(),
    ]);

    return NextResponse.json({ methods, connectable });
}

const startSchema = z.object({ provider: z.string().min(1).max(64) });

/**
 * POST - the first half of a connect. It writes down that this session asked
 * for this provider; the browser then goes to the provider, and the sign-in
 * callback links only when the same session comes back with that note
 * waiting. See sign-in-methods.ts.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });

    // Auth.js links to the cookie's own subject, which is the admin while
    // they act as somebody else, so a connect started here would land on the
    // wrong account.
    if (session.user.originalUserId) {
        return NextResponse.json({ error: "Not while acting as another member", code: "impersonating" }, { status: 403 });
    }

    const allowed = await rateLimitForRoleAsync(
        `sign-in-method-connect:${session.user.id}`,
        { maxRequests: 10, windowMs: 60_000 },
        session.user.role,
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request", code: "invalid_input" }, { status: 400 });
    }
    const { provider } = parsed.data;

    if (!(await connectableProviders()).includes(provider)) {
        return NextResponse.json({ error: "That sign-in method is not available", code: "unknown_provider" }, { status: 400 });
    }

    const held = await signInMethodsOf(session.user.id);
    if (held.some((method) => method.provider === provider)) {
        return NextResponse.json({ error: "Already connected", code: "already_connected" }, { status: 409 });
    }

    // The note is keyed by the session, so a session the server cannot name
    // cannot start one. A token minted before session ids existed is the
    // ordinary way to get here; signing in again mints one that has an id.
    const tokenId = await callerSessionTokenId(request);
    if (!tokenId) {
        return NextResponse.json({ error: "Sign in again to connect", code: "session_unknown" }, { status: 409 });
    }

    await startConnect(session.user.id, tokenId, provider);
    return NextResponse.json({ ok: true });
}
