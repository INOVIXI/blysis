/**
 * GET /api/v1/game-connect/catalog - what a game may show and sell.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `serverGet`. Answers 304 to a client that already holds this version.
 */
import { NextResponse } from "next/server";
import { readCatalog, versionOf } from "../../lib/catalog";
import { serverGet } from "../../lib/server-route";

export const GET = serverGet(async (_server, request) => {
    const catalog = await readCatalog();
    const version = versionOf(catalog);
    const etag = `"${version}"`;
    // The ETag is the version in quotes. A client that sends the bare version it read from the body means the same.
    const held = request.headers.get("if-none-match");
    if (held === etag || held === version) {
        return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }
    return NextResponse.json({ version, ...catalog }, { headers: { ETag: etag, "Cache-Control": "no-store" } });
});
