/**
 * POST /api/v1/game-connect/link/confirm - a signed-in member confirms a code a player made in game.
 *
 * The member is the session; the game account is whatever the code was made
 * for. The server the player asked from is told, so it can say so in game.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitStrict, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { bind, spend } from "../../../lib/links";
import { emitEvent } from "../../../lib/events";

const confirmSchema = z.object({ code: z.string().min(4).max(32) });

export async function POST(request: NextRequest) {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await rateLimitStrict(`gc-link-confirm:${userId}`, { maxRequests: 10, windowMs: 10 * 60_000 });
    if (!limited.success) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter the code", code: "code_invalid" }, { status: 400 });

    const code = await spend(parsed.data.code, "game");
    if (!code?.externalId || !code.name) {
        return NextResponse.json({ error: "That code is wrong, used or expired.", code: "code_invalid" }, { status: 409 });
    }
    const bound = await bind(code.platform, code.externalId, code.name, userId);
    if (!bound.ok) return NextResponse.json({ error: "Already linked", code: bound.code }, { status: 409 });

    await emitEvent(
        "link.confirmed",
        { player: { id: code.externalId, name: code.name }, member: bound.username },
        code.gameServerId,
    );
    return NextResponse.json({ linked: true, platform: code.platform, name: code.name });
}
