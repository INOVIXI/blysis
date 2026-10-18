/**
 * POST /api/v1/game-connect/jobs/report - what happened to claimed jobs.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `authenticateServer`. Any process of the server may report, not only the
 * current one, so a restarted server can replay its journal.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/core/sdk/server";
import { authenticateServer, refuse } from "../../../lib/auth";
import { report } from "../../../lib/queue";

const reportSchema = z.object({
    instance: z.string().min(8).max(64),
    results: z
        .array(
            z.object({
                id: z.string().min(1).max(64),
                outcome: z.enum(["done", "failed", "deferred", "unknown"]),
                detail: z.string().max(2000).nullish(),
            }),
        )
        .max(200),
});

export async function POST(request: NextRequest) {
    const server = await authenticateServer(request);
    if (server instanceof NextResponse) return server;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
        return refuse(422, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid report");
    }

    const accepted = await report(
        server.gameServerId,
        parsed.data.results.map((r) => ({ id: r.id, outcome: r.outcome, detail: r.detail ?? null })),
    );
    return NextResponse.json({ accepted }, { headers: { "Cache-Control": "no-store" } });
}
