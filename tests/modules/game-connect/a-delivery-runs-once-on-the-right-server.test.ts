// @vitest-environment node
/**
 * The delivery queue: a job reaches the server it is for, when the player it
 * is for is there, in the order it was bought, and never twice.
 *
 * Every state change is a conditional write, so the races here are the ones a
 * real site meets: two servers polling at once, a lease running out under a
 * slow server, an answer lost on the way back, a report that arrives late.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeTable, fakeTransaction } from "./fake-prisma";

const jobs = fakeTable(() => ({
    state: "PENDING",
    playerId: null,
    userId: null,
    claimedServerId: null,
    claimedInstance: null,
    claimedAt: null,
    leaseUntil: null,
    detail: null,
    settledAt: null,
    referenceId: null,
    referenceLabel: null,
    createdAt: new Date(),
}));
const presence = fakeTable(() => ({ seenAt: new Date() }));
const servers = fakeTable(() => ({ enabled: true }));
const gameServers = fakeTable(() => ({ isActive: true, isDefault: false, order: 0 }));

const prismaMock: Record<string, unknown> = {
    gameConnectJob: jobs,
    gameConnectPresence: presence,
    gameConnectServer: servers,
};
prismaMock.$transaction = fakeTransaction(prismaMock, [jobs.table, presence.table, servers.table]);

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown) =>
        hook === "servers.list" ? gameServers.table.rows.map((row) => ({ name: String(row.id), type: "minecraft", ...row })) : value,
    ),
}));

const queue = await import("@/modules/game-connect/lib/queue");
const { onlineOn, recordStatus } = await import("@/modules/game-connect/lib/presence");
const { default: onServerCommand } = await import("@/modules/game-connect/hooks/on-server-command");

const LEASE = 120;
const INTERVAL = 30;
const survival = { gameServerId: "g-survival", instance: "inst-survival", acceptFollowPlayer: false };
const lobby = { gameServerId: "g-lobby", instance: "inst-lobby", acceptFollowPlayer: true };

function job(over: Partial<Parameters<typeof queue.enqueue>[0]> = {}) {
    return {
        command: "give Notch diamond 1",
        gameServerId: survival.gameServerId,
        targetCurrent: false,
        whenOnline: false,
        player: { name: "Notch", id: null, userId: "u1" },
        groupKey: `order:o1:${over.gameServerId ?? survival.gameServerId}`,
        sequence: 0,
        reference: { kind: "order" as const, id: "o1", label: "Diamonds" },
        ...over,
    };
}

async function online(server: { gameServerId: string }, players: { id: string | null; name: string }[], at = new Date()) {
    await recordStatus({ id: `row-${server.gameServerId}`, gameServerId: server.gameServerId }, {
        online: players.length,
        max: 100,
        players,
        version: "26.2",
        performance: null,
    }, at);
}

async function claim(server: typeof survival, at = new Date()) {
    return queue.claimFor(server, await onlineOn(server.gameServerId, INTERVAL, at), LEASE, at);
}

function state(id: string) {
    return jobs.table.rows.find((r) => r.id === id)?.state;
}

beforeEach(() => {
    jobs.table.rows = [];
    presence.table.rows = [];
    servers.table.rows = [
        { id: "row-g-survival", gameServerId: "g-survival", enabled: true },
        { id: "row-g-lobby", gameServerId: "g-lobby", enabled: true, acceptFollowPlayer: true },
    ];
    gameServers.table.rows = [
        { id: "g-survival", isActive: true, isDefault: true, order: 0 },
        { id: "g-lobby", isActive: true, isDefault: false, order: 1 },
        { id: "g-rcon", isActive: true, isDefault: false, order: 2 },
    ];
});

describe("which server takes a job", () => {
    it("is the server it was aimed at, and no other", async () => {
        await queue.enqueue(job());
        expect(await claim(lobby)).toEqual([]);
        const taken = await claim(survival);
        expect(taken).toHaveLength(1);
        expect(taken[0]).toMatchObject({ command: "give Notch diamond 1", player: { name: "Notch" } });
        expect(state(taken[0].id)).toBe("CLAIMED");
    });

    it("waits for the player when it has to", async () => {
        await queue.enqueue(job({ whenOnline: true }));
        expect(await claim(survival)).toEqual([]);
        await online(survival, [{ id: "uuid-notch", name: "Notch" }]);
        expect(await claim(survival)).toHaveLength(1);
    });

    it("follows the player when it is aimed at wherever they are", async () => {
        await queue.enqueue(job({ gameServerId: null, targetCurrent: true, groupKey: "order:o1:current" }));
        await online(lobby, [{ id: "uuid-notch", name: "Notch" }]);
        expect(await claim(survival)).toEqual([]);
        expect(await claim(lobby)).toHaveLength(1);
    });

    it("goes only to a server an admin trusts to follow players", async () => {
        await queue.enqueue(job({ gameServerId: null, targetCurrent: true, groupKey: "order:o1:current" }));
        // Survival says the player is on it, but nobody trusted it to say so.
        await online(survival, [{ id: "uuid-notch", name: "Notch" }]);
        expect(await claim(survival)).toEqual([]);
        expect(jobs.table.rows[0].state).toBe("PENDING");
    });

    it("counts a player online only while their server keeps reporting", async () => {
        await queue.enqueue(job({ whenOnline: true }));
        const longAgo = new Date(Date.now() - 10 * 60_000);
        await online(survival, [{ id: "uuid-notch", name: "Notch" }], longAgo);
        expect(await claim(survival)).toEqual([]);
    });

    it("keeps presence per server, so two servers on one site do not mix their players", async () => {
        await online(survival, [{ id: "uuid-notch", name: "Notch" }]);
        await online(lobby, [{ id: "uuid-jeb", name: "jeb_" }]);
        const onSurvival = await onlineOn(survival.gameServerId, INTERVAL);
        expect([...onSurvival.ids]).toEqual(["uuid-notch"]);
        await online(survival, []);
        expect((await onlineOn(lobby.gameServerId, INTERVAL)).ids.has("uuid-jeb")).toBe(true);
    });
});

describe("a purchase of several lines", () => {
    it("is taken whole and in order", async () => {
        await queue.enqueue(job({ command: "second", sequence: 1 }));
        await queue.enqueue(job({ command: "first", sequence: 0 }));
        const taken = await claim(survival);
        expect(taken.map((j) => j.command)).toEqual(["first", "second"]);
    });

    it("waits whole when one of its lines waits for the player", async () => {
        await queue.enqueue(job({ command: "first", sequence: 0, whenOnline: false }));
        await queue.enqueue(job({ command: "second", sequence: 1, whenOnline: true }));
        expect(await claim(survival)).toEqual([]);
        await online(survival, [{ id: "uuid-notch", name: "Notch" }]);
        expect((await claim(survival)).map((j) => j.command)).toEqual(["first", "second"]);
    });

    it("is not split when another server took part of it first", async () => {
        const a = await queue.enqueue(job({ command: "first", sequence: 0 }));
        await queue.enqueue(job({ command: "second", sequence: 1 }));
        // Between this server's read and its claim, part of the group goes.
        const original = jobs.findMany.getMockImplementation()!;
        jobs.findMany.mockImplementationOnce(original).mockImplementationOnce(async (args) => {
            const rows = await original(args);
            const row = jobs.table.rows.find((r) => r.id === a.id)!;
            row.state = "CLAIMED";
            row.claimedServerId = "g-elsewhere";
            return rows;
        });
        expect(await claim(survival)).toEqual([]);
        expect(jobs.table.rows.filter((r) => r.claimedServerId === survival.gameServerId)).toHaveLength(0);
    });
});

describe("a name nobody had seen yet", () => {
    it("is pinned to the id of the player who joins under it", async () => {
        const { id } = await queue.enqueue(job({ whenOnline: true }));
        await online(survival, [{ id: "uuid-notch", name: "notch" }]);
        await claim(survival);
        expect(jobs.table.rows.find((r) => r.id === id)?.playerId).toBe("uuid-notch");
    });

    it("then follows the id through a rename", async () => {
        await queue.enqueue(job({ whenOnline: true, player: { name: "Notch", id: "uuid-notch", userId: "u1" } }));
        await online(survival, [{ id: "uuid-notch", name: "NotchRenamed" }]);
        expect(await claim(survival)).toHaveLength(1);
    });

    it("is never handed to somebody else who takes the old name", async () => {
        await queue.enqueue(job({ whenOnline: true, player: { name: "Notch", id: "uuid-notch", userId: "u1" } }));
        await online(survival, [{ id: "uuid-impostor", name: "Notch" }]);
        expect(await claim(survival)).toEqual([]);
    });
});

describe("what a server reports", () => {
    it("settles a job as done or failed", async () => {
        await queue.enqueue(job({ command: "a", groupKey: "g1" }));
        await queue.enqueue(job({ command: "b", groupKey: "g2" }));
        const [a, b] = await claim(survival);
        const accepted = await queue.report(survival.gameServerId, [
            { id: a.id, outcome: "done", detail: null },
            { id: b.id, outcome: "failed", detail: "Unknown command" },
        ]);
        expect(accepted).toEqual([a.id, b.id]);
        expect(state(a.id)).toBe("DONE");
        expect(state(b.id)).toBe("FAILED");
    });

    it("accepts the same outcome twice and changes nothing", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        await queue.report(survival.gameServerId, [{ id: a.id, outcome: "done", detail: null }]);
        expect(await queue.report(survival.gameServerId, [{ id: a.id, outcome: "done", detail: null }])).toEqual([a.id]);
    });

    it("puts a deferred job back in the queue untouched", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        await queue.report(survival.gameServerId, [{ id: a.id, outcome: "deferred", detail: null }]);
        expect(state(a.id)).toBe("PENDING");
        expect(await claim(survival)).toHaveLength(1);
    });

    it("sends an unknown outcome to review, and review is never handed out again", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        await queue.report(survival.gameServerId, [{ id: a.id, outcome: "unknown", detail: null }]);
        expect(state(a.id)).toBe("NEEDS_REVIEW");
        expect(await claim(survival)).toEqual([]);
    });

    it("is ignored for a job another server holds", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        expect(await queue.report(lobby.gameServerId, [{ id: a.id, outcome: "done", detail: null }])).toEqual([]);
        expect(state(a.id)).toBe("CLAIMED");
    });
});

describe("a lease", () => {
    it("that runs out sends the job to review", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        await queue.expireLeases(new Date(Date.now() + (LEASE + 1) * 1000));
        expect(state(a.id)).toBe("NEEDS_REVIEW");
    });

    it("does not stop a late report from telling the truth", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        await queue.expireLeases(new Date(Date.now() + (LEASE + 1) * 1000));
        expect(await queue.report(survival.gameServerId, [{ id: a.id, outcome: "done", detail: null }])).toEqual([a.id]);
        expect(state(a.id)).toBe("DONE");
    });
});

describe("an answer lost on the way back", () => {
    it("is offered again to the same server inside its lease", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        const later = new Date(Date.now() + queue.REOFFER_AFTER_MS + 1000);
        const again = await claim(survival, later);
        expect(again.map((j) => j.id)).toEqual([a.id]);
    });

    it("is not offered again right away, nor to another server", async () => {
        await queue.enqueue(job());
        await claim(survival);
        expect(await claim(survival)).toEqual([]);
        const later = new Date(Date.now() + queue.REOFFER_AFTER_MS + 1000);
        expect(await claim(lobby, later)).toEqual([]);
    });
});

describe("an admin", () => {
    it("can send a job in review again, and only then does it go out", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        await queue.report(survival.gameServerId, [{ id: a.id, outcome: "unknown", detail: null }]);
        expect(await queue.resolveByAdmin(a.id, "send-again", "admin1")).toBe(true);
        expect(await claim(survival)).toHaveLength(1);
    });

    it("cannot cancel a job a server already holds", async () => {
        await queue.enqueue(job());
        const [a] = await claim(survival);
        expect(await queue.resolveByAdmin(a.id, "cancel", "admin1")).toBe(false);
        expect(state(a.id)).toBe("CLAIMED");
    });
});

describe("server.command", () => {
    const empty = { handled: false, ok: false, output: null, error: null };

    it("queues for a connected server and tells RCON to stand aside", async () => {
        const answer = await onServerCommand(empty, { command: "give Notch diamond 1", serverId: "g-survival" });
        expect(answer).toMatchObject({ handled: true, ok: true, queued: true });
        expect(jobs.table.rows).toHaveLength(1);
    });

    it("uses the install's default server when none is named", async () => {
        await onServerCommand(empty, { command: "say hi" });
        expect(jobs.table.rows[0]?.gameServerId).toBe("g-survival");
    });

    it("leaves a server without a token to RCON", async () => {
        const answer = await onServerCommand(empty, { command: "say hi", serverId: "g-rcon" });
        expect(answer).toEqual(empty);
        expect(jobs.table.rows).toHaveLength(0);
    });

    it("leaves a switched-off server to RCON", async () => {
        servers.table.rows[0].enabled = false;
        const answer = await onServerCommand(empty, { command: "say hi", serverId: "g-survival" });
        expect(answer).toEqual(empty);
    });

    it("does not touch a command another module already took", async () => {
        const taken = { handled: true, ok: true, output: "x", error: null };
        expect(await onServerCommand(taken, { command: "say hi", serverId: "g-survival" })).toBe(taken);
        expect(jobs.table.rows).toHaveLength(0);
    });

    it("leaves a follow-the-player command alone when no server is trusted with one", async () => {
        servers.table.rows[1].acceptFollowPlayer = false;
        const answer = await onServerCommand(empty, {
            command: "say hi",
            delivery: {
                target: "player",
                whenOnline: true,
                player: { name: "Notch", id: null, userId: "u1" },
                groupKey: "order:o2:current",
                sequence: 0,
                reference: { kind: "order", id: "o2", label: null },
            },
        });
        expect(answer).toEqual(empty);
    });

    it("carries who and why when the caller says", async () => {
        await onServerCommand(empty, {
            command: "lp user Notch parent add vip",
            serverId: "g-lobby",
            delivery: {
                target: "player",
                whenOnline: true,
                player: { name: "Notch", id: "uuid-notch", userId: "u1" },
                groupKey: "order:o9:current",
                sequence: 2,
                reference: { kind: "order", id: "o9", label: "VIP" },
            },
        });
        expect(jobs.table.rows[0]).toMatchObject({
            gameServerId: null,
            targetCurrent: true,
            playerId: "uuid-notch",
            groupKey: "order:o9:current",
            sequence: 2,
            referenceKind: "order",
        });
    });
});
