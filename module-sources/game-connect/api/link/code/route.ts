/**
 * POST /api/v1/game-connect/link/code - a signed-in member asks for a code to type in game.
 */
import { NextResponse } from "next/server";
import { prisma, rateLimitStrict } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { CODE_TTL_MS, generateCode, hashCode } from "../../../lib/links";

export async function POST() {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await rateLimitStrict(`gc-link-code:${userId}`, { maxRequests: 5, windowMs: 10 * 60_000 });
    if (!limited.success) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });

    await prisma.gameConnectLinkCode.deleteMany({ where: { direction: "site", userId } });
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await prisma.gameConnectLinkCode.create({
        data: { direction: "site", codeHash: hashCode(code), platform: "any", userId, expiresAt },
    });
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
