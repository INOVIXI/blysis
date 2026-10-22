/**
 * Typing the code back in.
 *
 * The name is taken from the pending request rather than from this body: the
 * only thing the user supplies here is the code, so there is nothing to
 * substitute a different name into.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, rateLimits, withRateLimit, readJsonBody } from "@/core/sdk/server";
import { doActionAsync } from "@/core/sdk";
import { auth } from "@/core/sdk/auth";
import { redeemCode } from "../../../lib/link-code";
import { lookupProfile } from "../../../lib/mojang";
import { confirmSchema } from "../../../lib/validations";

export const POST = withRateLimit("minecraft-link-confirm", async (request: NextRequest) => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "code_required" }, { status: 400 });
    const { code } = parsed.data;

    const result = await redeemCode(userId, code);
    if (!result.ok) {
        const status = result.reason === "too-many-attempts" ? 429 : 400;
        return NextResponse.json({ error: result.reason, attemptsLeft: result.attemptsLeft }, { status });
    }

    const profile = await lookupProfile(result.username);

    // Between the whisper and the code coming back, someone else could have
    // linked the same name, in any case. Last check before it becomes a
    // binding.
    const taken = await prisma.minecraftAccount.findFirst({
        where: {
            OR: [{ username: { equals: result.username, mode: "insensitive" } }, ...(profile ? [{ uuid: profile.uuid }] : [])],
            userId: { not: userId },
        },
        select: { id: true },
    });
    if (taken) return NextResponse.json({ error: "already_linked" }, { status: 409 });

    const account = await prisma.minecraftAccount.upsert({
        where: { userId },
        create: { userId, username: result.username, uuid: profile?.uuid ?? null },
        update: { username: result.username, uuid: profile?.uuid ?? null },
    });

    await doActionAsync("minecraft.account.linked", {
        userId,
        username: account.username,
        uuid: account.uuid,
    });

    return NextResponse.json({ username: account.username, uuid: account.uuid });
}, rateLimits.auth);
