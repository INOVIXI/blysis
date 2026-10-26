// @vitest-environment node
/**
 * `{servers.online}` and `{servers.max}`: how many are playing, and how many
 * could, for any sentence on the site.
 *
 * Counted the way the homepage's tile counts: only servers that can be asked,
 * and a server that is down has nobody on it and no room either. With no
 * server that can be asked there is no number at all, which is not the same
 * as nobody, so the sentence shows its fallback rather than a zero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ servers: [] as Record<string, unknown>[] }));

vi.mock("@/modules/servers/lib/server-query", () => ({
    getAllServerStatuses: async () => state.servers,
}));

const online = (await import("@/modules/servers/placeholders/online")).default;
const max = (await import("@/modules/servers/placeholders/max")).default;
const { ModulePlaceholders } = await import("@/core/generated/module-placeholders");

const server = (queryable: boolean, up: boolean, players: number, slots: number) => ({
    queryable, online: up, players: { online: players, max: slots },
});

beforeEach(() => {
    state.servers = [];
});

describe("how many are playing", () => {
    it("adds up the servers that answered", async () => {
        state.servers = [server(true, true, 128, 500), server(true, true, 54, 200), server(true, false, 9, 100), server(false, true, 7, 50)];
        expect(await online()).toBe(182);
        expect(await max()).toBe(700);
    });

    it("is no number at all when no server can be asked", async () => {
        state.servers = [server(false, true, 7, 50)];
        expect(await online()).toBeNull();
        expect(await max()).toBeNull();
    });

    it("is declared for the panel, with a label and an example", () => {
        const declared = ModulePlaceholders.filter((p) => p.module === "servers").map((p) => [p.name, p.labelKey, p.example]);
        expect(declared).toEqual([
            ["servers.max", "placeholder_servers_max", "500"],
            ["servers.online", "placeholder_servers_online", "214"],
        ]);
    });
});
