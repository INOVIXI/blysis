/**
 * POST /api/v1/game-connect/hello - a game server process introduces itself.
 *
 * @provider-callback: the caller is a game server, not a browser. It is
 * authenticated by its token in `authenticateServer` before anything is read.
 *
 * Saying hello makes this process the token's current one. Whoever held it
 * before is superseded and told so on its next call. When that happened while
 * the previous process was still live, the answer says so: after a restart
 * that was the old process, and otherwise two servers share one token, which
 * the console of both should say out loud.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, readJsonBody, readSettingStrings, resolveAppName, resolveAppUrl } from "@/core/sdk/server";
import { authenticateServer, refuse } from "../../lib/auth";
import { connectSettings } from "../../lib/settings";
import { catalogVersion } from "../../lib/catalog";
import { serverNames } from "../../lib/servers";

/** A previous process seen this recently was alive when it lost the token. */
const TAKEOVER_WINDOW_MS = 90_000;

const helloSchema = z.object({
    instance: z.string().min(8).max(64),
    client: z.object({ name: z.string().min(1).max(64), version: z.string().min(1).max(32) }),
    game: z.string().min(1).max(32),
    software: z.object({ name: z.string().min(1).max(64), version: z.string().min(1).max(64) }),
    role: z.enum(["server", "network-root"]),
});

export async function POST(request: NextRequest) {
    const server = await authenticateServer(request);
    if (server instanceof NextResponse) return server;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = helloSchema.safeParse(body);
    if (!parsed.success) {
        return refuse(422, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid hello");
    }
    const hello = parsed.data;
    const now = new Date();
    // Read before the write below, which replaces both.
    const previous = { instance: server.instance, seenAt: server.instanceSeenAt };

    const previousLive =
        previous.instance !== null &&
        previous.instance !== hello.instance &&
        previous.seenAt !== null &&
        now.getTime() - previous.seenAt.getTime() <= TAKEOVER_WINDOW_MS;

    await prisma.gameConnectServer.update({
        where: { id: server.id },
        data: {
            instance: hello.instance,
            instanceSeenAt: now,
            ...(previous.instance && previous.instance !== hello.instance
                ? { previousInstance: previous.instance, previousSeenAt: previous.seenAt }
                : {}),
            game: hello.game,
            role: hello.role,
            clientName: hello.client.name,
            clientVersion: hello.client.version,
            softwareName: hello.software.name,
            softwareVersion: hello.software.version,
        },
    });

    const [names, settings, siteSettings, version] = await Promise.all([
        serverNames(),
        connectSettings(),
        readSettingStrings(["site_name"]).catch(() => ({}) as Record<string, string | null>),
        catalogVersion(),
    ]);

    return NextResponse.json(
        {
            server: { id: server.gameServerId, name: names.get(server.gameServerId) ?? "" },
            site: { name: siteSettings.site_name || resolveAppName(), url: resolveAppUrl() },
            settings: { ...settings, catalogVersion: version },
            takeover: previousLive
                ? { previousInstance: previous.instance, lastSeen: previous.seenAt?.toISOString() ?? null }
                : null,
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}
