// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A punishment lifted on the game server is news to the member it was
 * against. The site had no way to say so: the record flipped to inactive and
 * nothing was raised, because `punishments.punishment.revoked` was fired only
 * by the admin screen, and an unban typed into a game server never passes
 * through it.
 *
 * What makes it safe to raise from a read is that the read is idempotent and
 * the event is not. A first full read of a server with ten years of history
 * arrives carrying thousands of punishments that were lifted years ago, and
 * announcing those would be ten years of apologies delivered at once.
 *
 * So the event follows the *transition*, not the report. A row that arrives
 * already lifted is history being written down for the first time and says
 * nothing. A row this site holds as standing, which the server now says is
 * lifted, is the thing that just happened. That also means "read everything
 * again" is safe to press: it re-reads the same rows, finds no change in them,
 * and stays quiet - except where something really did change, which is exactly
 * when a member should hear about it.
 */

const state: { existing: { active: boolean } | null } = { existing: null };
const upsert = vi.fn(async () => ({ id: "p1" }));
const actions: { hook: string; payload: unknown }[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        punishment: {
            findUnique: async () => state.existing,
            upsert: (args: unknown) => upsert(args as never),
        },
    },
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/core/sdk", () => ({
    doActionAsync: async (hook: string, payload: unknown) => { actions.push({ hook, payload }); },
}));

const lifted = {
    source: "minecraft-litebans",
    externalRef: "ban:4821",
    playerName: "aeryn",
    type: "ban",
    active: false,
};

async function record(input: Record<string, unknown>) {
    const handler = (await import("../../../module-sources/punishments/hooks/record")).default;
    return handler({ recorded: false, id: null } as never, input as never);
}

beforeEach(() => {
    upsert.mockClear();
    actions.length = 0;
    state.existing = null;
    vi.resetModules();
});

describe("a lift is news only when something changed", () => {
    it("tells the member when a punishment this site held as standing is lifted", async () => {
        state.existing = { active: true };

        await record(lifted);

        expect(actions.map((a) => a.hook)).toContain("punishments.punishment.revoked");
    });

    it("says nothing about a punishment that arrives already lifted", async () => {
        // The first full read of an old server. This is history, not news.
        state.existing = null;

        await record(lifted);

        expect(actions).toEqual([]);
    });

    it("says nothing when a read re-confirms a lift it already recorded", async () => {
        state.existing = { active: false };

        await record(lifted);

        expect(actions).toEqual([]);
    });

    it("says nothing when the punishment is still standing", async () => {
        state.existing = { active: true };

        await record({ ...lifted, active: true });

        expect(actions).toEqual([]);
    });

    it("carries who lifted it and why into the record", async () => {
        state.existing = { active: true };

        await record({ ...lifted, liftedBy: "Aeryn", liftReason: "wrong player" });

        const args = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
        expect(args.create.liftedBy).toBe("Aeryn");
        expect(args.create.liftReason).toBe("wrong player");
    });

    it("leaves both empty when the other system did not say", async () => {
        state.existing = null;

        await record(lifted);

        const args = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
        expect(args.create.liftedBy).toBeNull();
        expect(args.create.liftReason).toBeNull();
    });
});
