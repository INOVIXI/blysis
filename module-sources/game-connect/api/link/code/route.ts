/**
 * POST /api/v1/game-connect/link/code - a signed-in member asks for a code to type in game.
 *
 * Refused when every connected game links players by username: no server
 * would take the code.
 */
import { NextResponse } from "next/server";
import { prisma, rateLimitStrict } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { CODE_TTL_MS, generateCode, hashCode } from "../../../lib/links";
import { codesOpen } from "../../../lib/names";
import { nameSettings } from "../../../lib/settings";

export async function POST() {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await rateLimitStrict(`gc-link-code:${userId}`, { maxRequests: 5, windowMs: 10 * 60_000 });
    if (!limited.success) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    if (!(await codesOpen(await nameSettings()))) {
        return NextResponse.json({ error: "Your username is your player name: there is nothing to link", code: "linked_by_name" }, { status: 409 });
    }

    await prisma.gameConnectLinkCode.deleteMany({ where: { direction: "site", userId } });
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await prisma.gameConnectLinkCode.create({
        data: { direction: "site", codeHash: hashCode(code), platform: "any", userId, expiresAt },
    });
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
