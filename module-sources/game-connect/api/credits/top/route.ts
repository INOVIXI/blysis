/**
 * GET /api/v1/game-connect/credits/top?kind=balance|topups|latest&period=day|month|year|all&limit=10
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `serverGet`.
 */
import { top } from "../../../lib/bridge";
import { ok, serverGet } from "../../../lib/server-route";

const PERIODS = ["day", "month", "year", "all"] as const;
const KINDS = ["balance", "topups", "latest"] as const;

export const GET = serverGet(async (_server, request) => {
    const params = new URL(request.url).searchParams;
    const askedKind = params.get("kind");
    const kind = (KINDS as readonly string[]).includes(askedKind ?? "") ? (askedKind as (typeof KINDS)[number]) : "balance";
    const asked = params.get("period");
    const period = (PERIODS as readonly string[]).includes(asked ?? "") ? (asked as (typeof PERIODS)[number]) : "all";
    const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 10));
    const entries = await top(kind, period, limit);
    return ok({ entries: entries.map((e) => ({ rank: e.rank, name: e.name, amount: e.amount })) });
});
