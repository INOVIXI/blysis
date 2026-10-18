/**
 * Who is calling: a game server, proven by its token, from its current process.
 *
 * Every endpoint of this module is a provider callback: the caller has no
 * browser and no session, so the proxy's origin check does not apply and each
 * handler has to prove the caller itself. This is where it does.
 */
import { NextResponse } from "next/server";
import type { GameConnectServer } from "@prisma/client";
import { prisma } from "@/core/sdk/server";
import { bearerToken, hashToken, sameHash } from "./token";

export const PROTOCOL_VERSION = 1;
export const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];

/** How stale a heartbeat may be before it is written again. */
const HEARTBEAT_WRITE_MS = 10_000;

export type ConnectedServer = GameConnectServer;

export function refuse(
    status: number,
    code: string,
    error: string,
    extra: Record<string, unknown> = {},
): NextResponse {
    return NextResponse.json({ error, code, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The server behind the request, or the answer that turns it away.
 *
 * The lookup is by the token's hash, which the unique index answers in one
 * seek. The comparison after it is constant time as well, so the code path
 * says nothing about how close a guess came.
 */
export async function authenticateServer(request: Request): Promise<ConnectedServer | NextResponse> {
    const protocol = request.headers.get("x-game-connect-protocol");
    if (protocol === null || !SUPPORTED_PROTOCOLS.includes(Number(protocol))) {
        return refuse(426, "protocol_unsupported", "This site does not speak that protocol version.", {
            supported: SUPPORTED_PROTOCOLS,
        });
    }

    const token = bearerToken(request.headers.get("authorization"));
    if (!token) return refuse(401, "token_invalid", "No server holds that token.");

    const hash = hashToken(token);
    const server = await prisma.gameConnectServer.findUnique({ where: { tokenHash: hash } });
    if (!server || !sameHash(server.tokenHash, hash)) {
        return refuse(401, "token_invalid", "No server holds that token.");
    }
    if (!server.enabled) {
        return refuse(403, "server_disabled", "An administrator switched this server off.");
    }
    return server;
}

/**
 * Whether a server authenticated earlier in this request still holds the same
 * token, is still switched on and still names this process as its own.
 *
 * A long-poll lives for half a minute. A token an admin revoked, a server an
 * admin switched off, or a process another one superseded in that time must
 * not claim anything in the rest of it.
 */
export async function stillCurrent(
    server: ConnectedServer,
    instance: string,
): Promise<NextResponse | { acceptFollowPlayer: boolean }> {
    const fresh = await prisma.gameConnectServer.findUnique({
        where: { id: server.id },
        select: { tokenHash: true, enabled: true, instance: true, acceptFollowPlayer: true },
    });
    if (!fresh || !sameHash(fresh.tokenHash, server.tokenHash)) {
        return refuse(401, "token_invalid", "No server holds that token.");
    }
    if (!fresh.enabled) return refuse(403, "server_disabled", "An administrator switched this server off.");
    if (fresh.instance !== instance) {
        return refuse(409, "superseded", "Another process said hello with this token after this one.");
    }
    return { acceptFollowPlayer: fresh.acceptFollowPlayer };
}

/**
 * Turns away a process that is no longer the token's current one, and keeps
 * the current one's heartbeat fresh without writing on every call.
 */
export async function requireCurrentInstance(
    server: ConnectedServer,
    instance: string,
    now: Date = new Date(),
): Promise<NextResponse | null> {
    if (!server.instance || server.instance !== instance) {
        return refuse(409, "superseded", "Another process said hello with this token after this one.");
    }
    const seen = server.instanceSeenAt?.getTime() ?? 0;
    if (now.getTime() - seen >= HEARTBEAT_WRITE_MS) {
        await prisma.gameConnectServer.update({
            where: { id: server.id },
            data: { instanceSeenAt: now },
        });
    }
    return null;
}
