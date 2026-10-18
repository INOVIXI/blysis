/**
 * GET /api/v1/game-connect/admin/jobs - the delivery queue, newest first.
 *
 * Filters by state and server, and finds a player or a command by `q`. Review is the state an admin comes here for:
 * every job in it may or may not have run, and only a person can say which.
 */
import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";

const STATES = ["PENDING", "CLAIMED", "DONE", "FAILED", "NEEDS_REVIEW", "CANCELLED"];

export async function GET(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const url = new URL(request.url);
    const { page, limit, skip } = pageParams(url.searchParams, { defaultLimit: 50 });
    const state = url.searchParams.get("state");
    const server = url.searchParams.get("server");
    const reference = url.searchParams.get("reference");
    const term = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 64);
    const where = {
        ...(term
            ? { OR: [{ playerNameLower: { contains: term } }, { command: { contains: term, mode: "insensitive" as const } }] }
            : {}),
        ...(state && STATES.includes(state) ? { state } : {}),
        ...(server ? { OR: [{ gameServerId: server }, { claimedServerId: server }] } : {}),
        ...(reference ? { referenceId: reference } : {}),
    };

    const [jobs, total] = await Promise.all([
        prisma.gameConnectJob.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
        prisma.gameConnectJob.count({ where }),
    ]);
    return NextResponse.json({ jobs, total, page, limit });
}
