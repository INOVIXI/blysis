/**
 * The link a user holds, and how they start or end one.
 *
 *   GET    - what this account is linked to, if anything
 *   POST   - claim a name: whisper a code to that player in game
 *   DELETE - unlink
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, isAdmin, rateLimits, withRateLimit, log, readJsonBody } from "@/core/sdk/server";
import { doActionAsync } from "@/core/sdk";
import { auth } from "@/core/sdk/auth";
import { issueCode, CODE_TTL_MS } from "../../lib/link-code";
import { lookupProfile, MINECRAFT_USERNAME } from "../../lib/mojang";
import { whisper } from "../../lib/whisper";
import { linkRequestSchema, unlinkSchema } from "../../lib/validations";

async function currentUserId(): Promise<string | null> {
    const session = await auth();
    return session?.user?.id ?? null;
}

export async function GET() {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const account = await prisma.minecraftAccount.findUnique({ where: { userId } });
    const pending = await prisma.minecraftLinkCode.findFirst({
        where: { userId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { username: true, expiresAt: true },
    });

    return NextResponse.json({
        account: account ? { username: account.username, uuid: account.uuid, linkedAt: account.linkedAt } : null,
        pending: pending ? { username: pending.username, expiresAt: pending.expiresAt } : null,
    });
}

// Whispering costs a message in someone else's chat window, so this is
// deliberately on the auth limiter rather than the general API one.
export const POST = withRateLimit("minecraft-link", async (request: NextRequest) => {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = linkRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    }
    const requested = parsed.data.username ?? "";
    const serverId = parsed.data.serverId || null;

    if (!MINECRAFT_USERNAME.test(requested)) {
        return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    }

    // Best effort: a rename means the name typed here and the name Mojang
    // knows can differ, and the canonical one is what the server will match.
    const profile = await lookupProfile(requested);
    const username = profile?.name ?? requested;

    // Claiming a name someone has already linked is refused without saying
    // which account holds it. Minecraft names are one player in any case, and
    // without a Mojang profile the name is all there is to compare.
    const taken = await prisma.minecraftAccount.findFirst({
        where: {
            OR: [{ username: { equals: username, mode: "insensitive" } }, ...(profile ? [{ uuid: profile.uuid }] : [])],
            userId: { not: userId },
        },
        select: { id: true },
    });
    if (taken) return NextResponse.json({ error: "already_linked" }, { status: 409 });

    const code = await issueCode({ userId, username, serverId });
    const outcome = await whisper({ username, message: code, serverId });

    if (!outcome.ok) {
        // The code is useless if it never arrived, and leaving it live would
        // let a second request confirm a name the player never saw a code for.
        await prisma.minecraftLinkCode.deleteMany({ where: { userId } });
        if (outcome.reason === "no-server") {
            return NextResponse.json({ error: "no_server" }, { status: 503 });
        }
        if (outcome.reason === "offline") {
            return NextResponse.json({ error: "player_offline" }, { status: 409 });
        }
        log.warn("[minecraft-link] could not whisper a link code", { detail: outcome.detail });
        return NextResponse.json({ error: "whisper_failed" }, { status: 502 });
    }

    return NextResponse.json({ username, expiresInMs: CODE_TTL_MS });
}, rateLimits.auth);

export async function DELETE(request: NextRequest) {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // An admin clearing someone else's link is a moderation action; a user
    // clearing their own is not.
    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsedUnlink = unlinkSchema.safeParse(body);
    if (!parsedUnlink.success) {
        return NextResponse.json({ error: parsedUnlink.error.issues[0].message }, { status: 400 });
    }
    const targetId = parsedUnlink.data.userId || userId;
    if (targetId !== userId && !(await isAdmin(userId))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existing = await prisma.minecraftAccount.findUnique({ where: { userId: targetId } });
    if (!existing) return NextResponse.json({ ok: true });

    await prisma.minecraftAccount.delete({ where: { userId: targetId } });
    await prisma.minecraftLinkCode.deleteMany({ where: { userId: targetId } });

    await doActionAsync("minecraft.account.unlinked", {
        userId: targetId,
        username: existing.username,
        uuid: existing.uuid,
    });

    return NextResponse.json({ ok: true });
}
