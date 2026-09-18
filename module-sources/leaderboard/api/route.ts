import { NextRequest, NextResponse } from "next/server";
import { cached } from "@/core/sdk/server";
import { applyFiltersAsync } from "@/core/sdk";

const LEADERBOARD_TTL_MS = 5 * 60_000;

/**
 * Where a named period starts, or null for all of it.
 *
 * Counted back from now rather than from a calendar boundary: "this month"
 * meaning the 1st makes a board that is nearly empty on the 1st and full on
 * the 30th, and a reader cannot tell that from the ranking having changed.
 */
const DAYS: Record<string, number> = { week: 7, month: 30, year: 365 };

function periodStart(period: string): Date | null {
    const days = DAYS[period];
    return days ? new Date(Date.now() - days * 86_400_000) : null;
}

/**
 * The boards this install can show, and the rows of one of them.
 *
 * This module owns the page and the ranking; it owns none of the data. It
 * used to query the shop's `Order`, the forum's `ForumPost` and the vote
 * module's `VoteLog`, each behind a "is this model installed?" lookup, which
 * is a module reading three tables it does not own and naming three features
 * it does not ship. Adding a fourth ranking meant editing this file.
 *
 * Now a module with something worth ranking answers `leaderboard.boards` and
 * appends its own. Without a boardId the answer is the list of tabs, which
 * costs a module nothing to give; with one, the module that owns that board
 * fills it.
 */
// GET /api/v1/leaderboard?board=<id>&limit=20&period=month&q=name
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const boardId = params.get("board");
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20") || 20));
    const period = params.get("period") ?? "";
    const search = (params.get("q") ?? "").trim().slice(0, 64);
    const since = periodStart(period);

    const boards = await cached(
        // The term is in the key, so two readers looking for two different
        // people do not read each other's answer back.
        `leaderboard:${boardId ?? "index"}:${limit}:${period}:${search.toLowerCase()}`,
        LEADERBOARD_TTL_MS,
        () => applyFiltersAsync("leaderboard.boards", [], { boardId, limit, search, since }),
    );

    // A board named in the address that nobody offers is not an error: the
    // module that had it may have been uninstalled since the link was made.
    return NextResponse.json({ boards });
}
