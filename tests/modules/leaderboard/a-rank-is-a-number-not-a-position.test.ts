// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A leaderboard is a ranking, so the rank has to be a fact about the row.
 *
 * The page drew `#{index + 1}` from where a row landed in the array, which is
 * right exactly while the array is the whole board in order and nothing else.
 * The moment a reader narrows it - to this month, to a name - the fifth place
 * holder is the only row left and the page calls them first.
 *
 * So the module that owns the board says what rank a row is, because it is the
 * only one that knows: it did the ordering. The page prints what it is told.
 */

const rows: { value: { userId: string | null; _count: number }[] } = { value: [] };
const queries: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        voteLog: {
            groupBy: async (args: Record<string, unknown>) => {
                queries.push(args);
                return rows.value;
            },
        },
        user: {
            findMany: async () => [
                { id: "u1", username: "aeryn", avatar: null },
                { id: "u2", username: "bolt", avatar: null },
                { id: "u3", username: "dusk", avatar: null },
            ],
        },
    },
}));

async function board(context: Record<string, unknown>) {
    const handler = (await import("../../../module-sources/vote/hooks/leaderboard-board")).default;
    const answer = await handler([] as never, context as never);
    return answer[0];
}

beforeEach(() => {
    rows.value = [
        { userId: "u1", _count: 11 },
        { userId: "u2", _count: 9 },
        { userId: "u3", _count: 6 },
    ];
    queries.length = 0;
    vi.resetModules();
});

describe("a rank is a number, not a position", () => {
    it("numbers the rows it ranked", async () => {
        const answer = await board({ boardId: "voters", limit: 20 });

        expect(answer.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
    });

    it("keeps the rank a searched row really has", async () => {
        const answer = await board({ boardId: "voters", limit: 20, search: "dusk" });

        // Third on the board, and third on the screen - not first because it
        // happens to be the only row left.
        expect(answer.rows).toHaveLength(1);
        expect(answer.rows[0]).toMatchObject({ username: "dusk", rank: 3 });
    });

    it("matches a name without being asked for the case", async () => {
        const answer = await board({ boardId: "voters", limit: 20, search: "AERYN" });

        expect(answer.rows[0]?.username).toBe("aeryn");
    });

    it("asks the database for a window when a period is named", async () => {
        const since = new Date("2026-09-01T00:00:00.000Z");
        await board({ boardId: "voters", limit: 20, since });

        // Narrowing in the database rather than after it: a month of votes is
        // what should be counted, not a month's worth taken from a total.
        expect(JSON.stringify(queries[0])).toContain("2026-09-01");
    });

    it("counts everything when no period is named", async () => {
        await board({ boardId: "voters", limit: 20 });

        expect(JSON.stringify(queries[0])).not.toContain("createdAt");
    });

    it("still answers the tab list without touching the table", async () => {
        const answer = await board({ boardId: null, limit: 20 });

        expect(answer.rows).toEqual([]);
        expect(queries).toEqual([]);
    });
});
