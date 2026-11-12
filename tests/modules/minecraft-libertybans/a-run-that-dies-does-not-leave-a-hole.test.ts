import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cursor is what stops the site re-reading the whole punishment history
 * every five minutes, and it is also the one thing here that can lose a
 * punishment for good.
 *
 * Moving it before the batch is recorded leaves it past rows nothing wrote down
 * when a run dies halfway, and no later run looks at them again. Moving it
 * after costs a few upserts on the next run, on a reference that does not
 * change. LibertyBans numbers every kind from one sequence, so there is one
 * cursor and a kick moves it as far as a ban does.
 */

const recorded: string[] = [];
const cursorWrites: { kind: string; lastId: bigint }[] = [];
let recordThrowsAt: number | null = null;
let seen = 0;
let windowAsked = false;

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: async (hook: string, fallback: unknown, context: unknown) => {
        if (hook === "game-account.resolve") return { userId: null };
        if (hook === "punishment.record") {
            seen += 1;
            if (recordThrowsAt !== null && seen === recordThrowsAt) throw new Error("the database went away");
            recorded.push((context as { externalRef: string }).externalRef);
            return { recorded: true, id: "written" };
        }
        return fallback;
    },
}));

let storedCursor: bigint | null = null;

vi.mock("@/core/sdk/server", () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    readSettingValues: async () => ({
        minecraft_libertybans_config: { connection: "mariadb://u:p@host:3306/lb", prefix: "libertybans_", enabled: true },
    }),
    prisma: {
        libertyBansSync: {
            findUnique: async () => (storedCursor === null ? null : { lastId: storedCursor }),
            upsert: async (args: { create: { kind: string; lastId: bigint } }) => {
                cursorWrites.push({ kind: args.create.kind, lastId: args.create.lastId });
                return args.create;
            },
        },
    },
}));

const PLAYER = Buffer.from("b50ad385829d3141a2167e7d7539ba7f", "hex");

/** A database that answers with a ban, a kick and a punishment against an address. */
vi.mock("@/modules/minecraft-libertybans/lib/read", async () => {
    const actual = await vi.importActual<typeof import("@/modules/minecraft-libertybans/lib/read")>(
        "@/modules/minecraft-libertybans/lib/read",
    );
    return {
        ...actual,
        withLibertyBans: async (
            _connection: string,
            _dialect: string,
            work: (reader: unknown) => Promise<unknown>,
        ) => {
            const reader = {
                columnsOf: async (table: string) =>
                    table === "libertybans_simple_history"
                        ? ["id", "type", "victim_type", "victim_uuid", "victim_address", "operator", "start", "end"]
                        : [],
                punishments: async (request: { scope: string }) => {
                    if (request.scope === "lifted") {
                        windowAsked = true;
                        return [];
                    }
                    return [
                        { id: 9, type: 0, victim_type: 0, victim_uuid: PLAYER, start: 1, end: 0, in_force: 1 },
                        { id: 10, type: 3, victim_type: 0, victim_uuid: PLAYER, start: 1, end: 0, in_force: 0 },
                        { id: 11, type: 0, victim_type: 1, victim_uuid: Buffer.alloc(16), start: 1, end: 0, in_force: 1 },
                    ];
                },
                namesFor: async () => new Map<string, string>(),
            };
            try {
                return { value: await work(reader) };
            } catch {
                return { failed: "failed", message: "The LibertyBans database could not be read." };
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
        storedCursor = null;
        windowAsked = false;
        vi.resetModules();
    });

    it("moves the one cursor to the highest id once the batch is in", async () => {
        const { syncLibertyBans } = await import("@/modules/minecraft-libertybans/lib/sync");

        const summary = await syncLibertyBans();

        expect(summary).toMatchObject({ read: 3, recorded: 2, skipped: 1, refused: 0 });
        expect(recorded).toEqual(["9", "10"]);
        expect(cursorWrites).toEqual([{ kind: "history", lastId: 11n }]);
    });

    it("leaves the cursor alone when the run dies mid-batch", async () => {
        recordThrowsAt = 2;
        const { syncLibertyBans } = await import("@/modules/minecraft-libertybans/lib/sync");

        const summary = await syncLibertyBans();

        expect(summary.failed).toBeDefined();
        expect(cursorWrites).toEqual([]);
    });

    it("looks behind the cursor for lifts only once there is something behind it", async () => {
        const { syncLibertyBans } = await import("@/modules/minecraft-libertybans/lib/sync");

        await syncLibertyBans();
        expect(windowAsked).toBe(false);

        storedCursor = 5n;
        await syncLibertyBans();
        expect(windowAsked).toBe(true);
    });
});
