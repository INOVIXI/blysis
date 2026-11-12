import { beforeEach, describe, expect, it, vi } from "vitest";
import { offlineUuid } from "@/modules/minecraft-libertybans/lib/uuid";

/**
 * On a server in offline mode the name is the account and the UUID is made from
 * it. A member who linked that name may be stored with any UUID at all, and the
 * modules answering `game-account.resolve` look a UUID up and never fall back
 * to the name when one is given. So a punishment would never find them.
 *
 * The answer here asks by name only when the UUID proves the server is in
 * offline mode: it is exactly the offline UUID of the name. A Mojang UUID never
 * is, so an online server keeps matching by UUID alone and a name that passed
 * to a new owner does not land on the old one.
 *
 * The resolver below behaves the way `minecraft-link`'s does.
 */

const linked = [{ userId: "member-1", uuid: "1d2b3c4d-0000-4000-8000-000000000001", username: "Kılıç" }];
const asked: { uuid: string | null; username: string | null }[] = [];

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: async (hook: string, fallback: unknown, lookup: { uuid: string | null; username: string | null }) => {
        if (hook !== "game-account.resolve") return fallback;
        asked.push({ uuid: lookup.uuid, username: lookup.username });
        const account = lookup.uuid
            ? linked.find((row) => row.uuid === lookup.uuid)
            : linked.find((row) => row.username.toLowerCase() === (lookup.username ?? "").toLowerCase());
        return { userId: account?.userId ?? null };
    },
}));

describe("a player on an offline server is found by name", () => {
    beforeEach(() => {
        asked.length = 0;
    });

    it("finds the member by name when the UUID is the offline one for it", async () => {
        const { memberFor } = await import("@/modules/minecraft-libertybans/lib/member");

        expect(await memberFor(offlineUuid("Kılıç"), "Kılıç")).toBe("member-1");
        expect(asked).toEqual([
            { uuid: offlineUuid("Kılıç"), username: "Kılıç" },
            { uuid: null, username: "Kılıç" },
        ]);
    });

    it("matches the name in any case once the UUID has said it is offline", async () => {
        const { memberFor } = await import("@/modules/minecraft-libertybans/lib/member");

        expect(await memberFor(offlineUuid("kılıç"), "kılıç")).toBe("member-1");
    });

    it("takes an exact UUID match without asking about the name", async () => {
        const { memberFor } = await import("@/modules/minecraft-libertybans/lib/member");

        expect(await memberFor("1d2b3c4d-0000-4000-8000-000000000001", "SomebodyElse")).toBe("member-1");
        expect(asked).toHaveLength(1);
    });

    it("never matches by name on an online server, where the UUID is not made from the name", async () => {
        const { memberFor } = await import("@/modules/minecraft-libertybans/lib/member");

        expect(await memberFor("069a79f4-44e9-4726-a5be-fca90e38aaf5", "Kılıç")).toBeNull();
        expect(asked).toHaveLength(1);
    });

    it("does not match a player whose name LibertyBans never saw", async () => {
        const { memberFor } = await import("@/modules/minecraft-libertybans/lib/member");
        const uuid = offlineUuid("Kılıç");

        // With no name, the UUID stands in for it, and that is not offline-made.
        expect(await memberFor(uuid, uuid)).toBeNull();
    });
});
