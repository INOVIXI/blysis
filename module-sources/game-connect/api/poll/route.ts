/**
 * POST /api/v1/game-connect/poll - the long-poll that is also the claim.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `authenticateServer` and by its process in `requireCurrentInstance`.
 *
 * The request is held until there is work for this server or the hold runs
 * out. While held it looks again whenever it is woken, and every few seconds
 * regardless, because a wake is only a shortcut. Whatever it returns is
 * already claimed: there is no window between "here is a job" and "the job is
 * yours" for a second server to fall into.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cached, readJsonBody } from "@/core/sdk/server";
import { authenticateServer, refuse, requireCurrentInstance, stillCurrent } from "../../lib/auth";
import { connectSettings } from "../../lib/settings";
import { claimFor, expireLeases } from "../../lib/queue";
import { onlineOn } from "../../lib/presence";
import { eventsAfter, latestCursor, seqOf } from "../../lib/events";
import { catalogVersion } from "../../lib/catalog";
import { waitForWake } from "../../lib/wake";

/** A held poll looks again at least this often, woken or not. */
const RECHECK_MS = 5_000;

const pollSchema = z.object({
    instance: z.string().min(8).max(64),
    eventCursor: z.string().max(32).nullish(),
});

export async function POST(request: NextRequest) {
    const server = await authenticateServer(request);
    if (server instanceof NextResponse) return server;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = pollSchema.safeParse(body);
    if (!parsed.success) {
        return refuse(422, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid poll");
    }
    const superseded = await requireCurrentInstance(server, parsed.data.instance);
    if (superseded) return superseded;

    const settings = await connectSettings();
    const deadline = Date.now() + settings.pollHoldSeconds * 1000;
    const queueServer = {
        gameServerId: server.gameServerId,
        instance: parsed.data.instance,
        acceptFollowPlayer: server.acceptFollowPlayer,
    };
    let cursor = seqOf(parsed.data.eventCursor) === null ? await latestCursor() : (parsed.data.eventCursor as string);

    let first = true;
    for (;;) {
        // The first round was just authenticated. Every later one checks
        // again, so a revoke, a switch-off or a takeover during the hold
        // stops this request before it claims anything.
        if (!first) {
            const fresh = await stillCurrent(server, parsed.data.instance);
            if (fresh instanceof NextResponse) return fresh;
            queueServer.acceptFollowPlayer = fresh.acceptFollowPlayer;
        }
        first = false;
        const now = new Date();
        await expireLeases(now);
        const online = await onlineOn(server.gameServerId, settings.statusIntervalSeconds, now);
        const jobs = await claimFor(queueServer, online, settings.leaseSeconds, now);
        const { events, cursor: next } = await eventsAfter(server.gameServerId, cursor, now);
        cursor = next;

        const remaining = deadline - Date.now();
        if (jobs.length > 0 || events.length > 0 || remaining <= 0) {
            const version = await cached("game-connect:catalog-version", 15_000, catalogVersion);
            return NextResponse.json(
                { jobs, events, eventCursor: cursor, catalogVersion: version },
                { headers: { "Cache-Control": "no-store" } },
            );
        }

        const outcome = await waitForWake(server.gameServerId, Math.min(RECHECK_MS, remaining), request.signal);
        if (outcome === "aborted") {
            // Nobody is listening. Nothing was claimed in this round, so
            // there is nothing to hand back.
            return new NextResponse(null, { status: 204 });
        }
    }
}
