/**
 * GET /api/v1/game-connect/credits/top?kind=balance|topups|latest&period=day|month|year|all&limit=10
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `serverGet`.
 */
import { top } from "../../../lib/bridge";
import { refuse } from "../../../lib/auth";
import { ok, serverGet } from "../../../lib/server-route";

const PERIODS = ["day", "month", "year", "all"] as const;
const KINDS = ["balance", "topups", "latest"] as const;

export const GET = serverGet(async (_server, request) => {
    const params = new URL(request.url).searchParams;
    // Left out, a kind is balance and a period is all. Named and unknown, it is refused: a ranking of
    // something else under the name asked for would be shown to players as the answer.
    const askedKind = params.get("kind") ?? "balance";
    const asked = params.get("period") ?? "all";
    if (!(KINDS as readonly string[]).includes(askedKind) || !(PERIODS as readonly string[]).includes(asked)) {
        return refuse(422, "invalid_request", `kind is one of ${KINDS.join(", ")}; period one of ${PERIODS.join(", ")}.`);
    }
    const kind = askedKind as (typeof KINDS)[number];
    const period = asked as (typeof PERIODS)[number];
    const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 10));
    const entries = await top(kind, period, limit);
    return ok({ entries: entries.map((e) => ({ rank: e.rank, name: e.name, amount: e.amount })) });
});
