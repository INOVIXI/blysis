/**
 * /api/v1/game-connect/link/confirm - a signed-in member confirms a code a player made in game.
 *
 * GET shows which game account a code would link, without spending it. POST
 * links it, and only when the request names that same account: the page
 * shows the account and the member agrees to that account, not to a code.
 * A code somebody else made and sent with a link is the attack this stops
 * from being one click: the member is shown a stranger's name first.
 *
 * The server the player asked from is told, so it can say so in game.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitStrict, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { bind, peek, spend } from "../../../lib/links";
import { emitEvent } from "../../../lib/events";

const confirmSchema = z.object({ code: z.string().min(4).max(32), account: z.string().min(1).max(64) });

function wrongCode(): NextResponse {
    return NextResponse.json({ error: "That code is wrong, used or expired.", code: "code_invalid" }, { status: 409 });
}

async function signedIn(kind: string): Promise<string | NextResponse> {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await rateLimitStrict(`gc-link-${kind}:${userId}`, { maxRequests: 10, windowMs: 10 * 60_000 });
    if (!limited.success) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    return userId;
}

export async function GET(request: NextRequest) {
    const userId = await signedIn("peek");
    if (userId instanceof NextResponse) return userId;
    const code = await peek(request.nextUrl.searchParams.get("code") ?? "", "game");
    if (!code?.externalId || !code.name) return wrongCode();
    return NextResponse.json({ platform: code.platform, name: code.name, expiresAt: code.expiresAt.toISOString() });
}

export async function POST(request: NextRequest) {
    const userId = await signedIn("confirm");
    if (userId instanceof NextResponse) return userId;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter the code", code: "code_invalid" }, { status: 400 });

    // Checked before the code is spent, so a page that showed nothing does not
    // burn the code of the player who made it.
    const shown = await peek(parsed.data.code, "game");
    if (!shown?.name || shown.name.toLowerCase() !== parsed.data.account.trim().toLowerCase()) {
        return NextResponse.json({ error: "Confirm the account the code is for", code: "account_mismatch" }, { status: 409 });
    }

    const code = await spend(parsed.data.code, "game");
    if (!code?.externalId || !code.name) return wrongCode();
    const bound = await bind(code.platform, code.externalId, code.name, userId);
    if (!bound.ok) return NextResponse.json({ error: "Already linked", code: bound.code }, { status: 409 });

    await emitEvent(
        "link.confirmed",
        { player: { id: code.externalId, name: code.name }, member: bound.username },
        code.gameServerId,
    );
    return NextResponse.json({ linked: true, platform: code.platform, name: code.name });
}
