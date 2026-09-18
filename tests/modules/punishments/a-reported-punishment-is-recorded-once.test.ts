// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A punishment reported twice is one punishment.
 *
 * The module that watches a game server answers a webhook, and a webhook is
 * delivered more than once: a retry after a timeout, a re-sync after the
 * server was down. LiteBans sends the same row id each time, so the record is
 * written on (source, externalRef) and a redelivery updates what is already
 * there. A ban listed twice is worse than one listed late.
 *
 * The reporter is also not allowed to file under `site`. That is what a
 * punishment an administrator issued here is called, and a module claiming it
 * would put its rows where a person's decisions are.
 */
const upsert = vi.fn(async () => ({ id: "p1" }));

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        punishment: {
            // The handler reads the row before it writes, to tell a lift that
            // just happened from history arriving for the first time. Nothing
            // here is about that; see
            // `a-lift-is-news-only-when-something-changed.test.ts`.
            findUnique: async () => null,
            upsert: (args: unknown) => upsert(args as never),
        },
    },
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {} }));

const report = {
    source: "minecraft-litebans",
    externalRef: "4821",
    playerName: "aeryn",
    type: "ban",
    reason: "griefing",
};

async function record(current: { recorded: boolean; id: string | null }, input: Record<string, unknown>) {
    const handler = (await import("../../../module-sources/punishments/hooks/record")).default;
    return handler(current as never, input as never);
}

beforeEach(() => {
    upsert.mockClear();
});

describe("a reported punishment is recorded once", () => {
    it("writes it against the reporter's own reference", async () => {
        const answer = await record({ recorded: false, id: null }, report);
        expect(answer).toEqual({ recorded: true, id: "p1" });
        const args = upsert.mock.calls[0][0] as { where: { source_externalRef: unknown } };
        expect(args.where.source_externalRef).toEqual({ source: "minecraft-litebans", externalRef: "4821" });
    });

    it("leaves it alone once somebody has recorded it", async () => {
        const answer = await record({ recorded: true, id: "already" }, report);
        expect(answer).toEqual({ recorded: true, id: "already" });
        expect(upsert).not.toHaveBeenCalled();
    });

    it("refuses a reporter claiming to be the site", async () => {
        const answer = await record({ recorded: false, id: null }, { ...report, source: "site" });
        expect(answer).toEqual({ recorded: false, id: null });
        expect(upsert).not.toHaveBeenCalled();
    });

    it("refuses a report with nothing to file", async () => {
        const answer = await record({ recorded: false, id: null }, { ...report, externalRef: "" });
        expect(answer).toEqual({ recorded: false, id: null });
        expect(upsert).not.toHaveBeenCalled();
    });

    it("says so rather than throwing when the write fails", async () => {
        upsert.mockRejectedValueOnce(new Error("deadlock"));
        const answer = await record({ recorded: false, id: null }, report);
        expect(answer).toEqual({ recorded: false, id: null });
    });
});
