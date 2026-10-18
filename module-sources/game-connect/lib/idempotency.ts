/**
 * The first answer to a call that moves money, kept so a retry gets it again.
 *
 * A game server that sent a purchase and timed out cannot know whether it
 * went through. It sends the same request with the same key, and this hands
 * back what happened the first time instead of doing it twice.
 *
 * The key is reserved before the work starts, by inserting it: a second call
 * that arrives while the first is still running finds the key taken and is
 * told to wait, rather than running alongside it.
 */
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/core/sdk/server";
import { refuse } from "./auth";

/** Status kept on the reserved row until the work finishes. */
const IN_FLIGHT = 0;

export async function onceFor(serverId: string, key: string, work: () => Promise<NextResponse>): Promise<NextResponse> {
    try {
        await prisma.gameConnectIdempotency.create({
            data: { serverId, key, status: IN_FLIGHT, response: {} as Prisma.InputJsonValue },
        });
    } catch {
        const kept = await prisma.gameConnectIdempotency.findUnique({ where: { serverId_key: { serverId, key } } });
        if (!kept || kept.status === IN_FLIGHT) {
            return refuse(409, "in_progress", "The same request is still being answered. Try again in a moment.");
        }
        return NextResponse.json(kept.response, { status: kept.status, headers: { "Cache-Control": "no-store" } });
    }

    let answer: NextResponse;
    try {
        answer = await work();
    } catch (error) {
        // Nothing was settled: free the key so a retry runs the work again.
        await prisma.gameConnectIdempotency.deleteMany({ where: { serverId, key } });
        throw error;
    }
    // A refusal that says the site was not ready to answer is not an outcome
    // worth replaying: free the key so the retry is answered fresh.
    if (answer.status >= 500) {
        await prisma.gameConnectIdempotency.deleteMany({ where: { serverId, key } });
        return answer;
    }
    const body = (await answer.clone().json().catch(() => ({}))) as Prisma.InputJsonValue;
    await prisma.gameConnectIdempotency.update({
        where: { serverId_key: { serverId, key } },
        data: { status: answer.status, response: body },
    });
    return answer;
}
