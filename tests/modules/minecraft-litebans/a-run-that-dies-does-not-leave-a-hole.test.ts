import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The cursor is what stops the site re-reading the whole ban table every five
 * minutes, and it is also the one thing here that can lose a punishment for
 * good.
 *
 * Moving it before the batch is recorded is cheap and wrong: a run that dies
 * halfway - the game server's database goes away, the process is stopped
 * mid-tick - leaves the cursor past rows nothing wrote down, and no later run
 * ever looks at them again. The hole is in a member's record and nothing would
 * ever surface it.
 *
 * Moving it after costs a few hundred upserts on the next run, which are
 * upserts on a reference that does not change, so they update rather than
 * duplicate. That is the whole reason the write goes through
 * `punishment.record` rather than into the table.
 */

const recorded: string[] = [];
const cursorWrites: { kind: string; lastId: bigint }[] = [];
let recordThrowsAt: number | null = null;
let seen = 0;

const filters = vi.fn(async (hook: string, fallback: unknown, context: unknown) => {
    if (hook === "game-account.resolve") return { userId: null };
    if (hook === "punishment.record") {
        seen += 1;
        if (recordThrowsAt !== null && seen === recordThrowsAt) throw new Error("the database went away");
        recorded.push((context as { externalRef: string }).externalRef);
        return { recorded: true, id: "written" };
    }
    return fallback;
});

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: (hook: string, fallback: unknown, context: unknown) => filters(hook, fallback, context),
}));

vi.mock("@/core/sdk/server", () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    readSettingValues: async () => ({
        minecraft_litebans_config: { connection: "mysql://u:p@host:3306/lb", prefix: "litebans_", enabled: true },
    }),
    prisma: {
        liteBansSync: {
            findUnique: async () => null,
            upsert: async (args: { create: { kind: string; lastId: bigint } }) => {
                cursorWrites.push({ kind: args.create.kind, lastId: args.create.lastId });
                return args.create;
            },
        },
    },
}));

/** A database that answers with two bans and nothing else. */
vi.mock("@/modules/minecraft-litebans/lib/read", async () => {
    const actual = await vi.importActual<typeof import("@/modules/minecraft-litebans/lib/read")>(
        "@/modules/minecraft-litebans/lib/read",
    );
    return {
        ...actual,
        withLiteBans: async (
            _connection: string,
            _dialect: string,
            work: (reader: unknown) => Promise<unknown>,
        ) => {
            const reader = {
                columnsOf: async (table: string) =>
                    table === "litebans_bans" ? ["id", "uuid", "until", "active", "time"] : [],
                punishments: async (request: { table: string; scope: string }) =>
                    request.table === "litebans_bans" && request.scope === "new"
                        ? [
                            { id: 9, uuid: "aaa", until: 0, active: 1 },
                            { id: 10, uuid: "bbb", until: 0, active: 1 },
                        ]
                        : [],
                namesFor: async () => new Map<string, string>(),
            };
            try {
                return { value: await work(reader) };
            } catch {
                return { failed: "failed", message: "The LiteBans database could not be read." };
            }
        },
    };
});

describe("the cursor never runs ahead of what was written down", () => {
    beforeEach(() => {
        recorded.length = 0;
        cursorWrites.length = 0;
        recordThrowsAt = null;
        seen = 0;
        vi.resetModules();
    });

    it("moves to the highest id once the batch is in", async () => {
        const { syncLiteBans } = await import("@/modules/minecraft-litebans/lib/sync");

        const summary = await syncLiteBans();

        expect(summary.recorded).toBe(2);
        expect(cursorWrites).toEqual([{ kind: "ban", lastId: 10n }]);
    });

    it("leaves the cursor alone when the run dies mid-batch", async () => {
        recordThrowsAt = 2;
        const { syncLiteBans } = await import("@/modules/minecraft-litebans/lib/sync");

        const summary = await syncLiteBans();

        expect(summary.failed).toBeDefined();
        // The next run reads 9 and 10 again, and the upsert makes that free.
        expect(cursorWrites).toEqual([]);
    });

    it("does not move a cursor for a kind whose table this server does not have", async () => {
        const { syncLiteBans } = await import("@/modules/minecraft-litebans/lib/sync");

        const summary = await syncLiteBans();

        expect(summary.missing).toEqual(["mute", "warning", "kick"]);
        expect(cursorWrites.map((write) => write.kind)).toEqual(["ban"]);
    });
});
