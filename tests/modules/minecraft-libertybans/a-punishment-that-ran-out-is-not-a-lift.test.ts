import { describe, expect, it } from "vitest";
import { toReport, type LibertyBansRow } from "@/modules/minecraft-libertybans/lib/row";
import { uuidBytes } from "@/modules/minecraft-libertybans/lib/uuid";

/**
 * LibertyBans has no flag saying a punishment was lifted. It deletes the
 * punishment from its kind's table, and it deletes one that ran out from the
 * same table. The punishments module tells a member their punishment was lifted
 * the moment a row goes from standing to not, so reading "gone" as "lifted"
 * would tell everybody whose tempban lapsed between two runs that staff had
 * pardoned them.
 *
 * Only `end` tells the two apart, in epoch seconds, with zero for permanent.
 */

const NOW = 1_800_000_000;
const PLAYER = "b50ad385-829d-3141-a216-7e7d7539ba7f";
const STAFF = "0f000000-0000-4000-8000-00000000000a";
const NAMES = new Map([[PLAYER, "Notch"], [STAFF, "Moderator"]]);

function row(overrides: Partial<LibertyBansRow>): LibertyBansRow {
    return {
        id: 42,
        type: 0,
        victim_type: 0,
        victim_uuid: uuidBytes(PLAYER),
        operator: uuidBytes(STAFF),
        reason: "griefing",
        scope: "",
        start: NOW - 3600,
        end: 0,
        in_force: 1,
        ...overrides,
    };
}

describe("a punishment that ran out is not a lift", () => {
    it("reads a permanent ban still in its table as standing", () => {
        const report = toReport(row({}), NAMES, NOW);

        expect(report).toMatchObject({ type: "ban", active: true, expiresAt: null, duration: null });
    });

    it("reads a permanent ban gone from its table as lifted", () => {
        expect(toReport(row({ in_force: 0 }), NAMES, NOW)?.active).toBe(false);
    });

    it("reads a tempban gone from its table before its end as lifted", () => {
        expect(toReport(row({ end: NOW + 3600, in_force: 0 }), NAMES, NOW)?.active).toBe(false);
    });

    it("reads a tempban gone from its table after its end as standing and expired", () => {
        const report = toReport(row({ end: NOW - 60, in_force: 0 }), NAMES, NOW);

        expect(report?.active).toBe(true);
        expect(report?.expiresAt).toBe(new Date((NOW - 60) * 1000).toISOString());
    });

    it("never reads a kick as lifted, because a kick is never in a table", () => {
        expect(toReport(row({ type: 3, in_force: 0 }), NAMES, NOW)).toMatchObject({ type: "kick", active: true });
    });

    it("names nobody as having lifted it, because LibertyBans does not record who did", () => {
        const report = toReport(row({ in_force: 0 }), NAMES, NOW);

        expect(report?.liftedBy).toBeNull();
        expect(report?.liftReason).toBeNull();
    });
});

describe("a LibertyBans row in the punishment record's words", () => {
    it("measures a sentence in seconds, from when it was placed", () => {
        const report = toReport(row({ type: 1, start: NOW - 86_400, end: NOW + 6 * 86_400 }), NAMES, NOW);

        expect(report).toMatchObject({ type: "tempMute", duration: "7d" });
    });

    it("keeps the four kinds apart by their ordinal", () => {
        const kinds = [0, 1, 2, 3].map((type) => toReport(row({ type }), NAMES, NOW)?.type);

        expect(kinds).toEqual(["ban", "mute", "warning", "kick"]);
    });

    it("refers to a punishment by its id alone, which is unique across kinds", () => {
        expect(toReport(row({ id: 7, type: 2 }), NAMES, NOW)?.externalRef).toBe("7");
    });

    it("names the player and the staff member from the names table", () => {
        expect(toReport(row({}), NAMES, NOW)).toMatchObject({ playerName: "Notch", playerUuid: PLAYER, punishedBy: "Moderator" });
    });

    it("leaves the console unnamed, so the screen says console in the reader's language", () => {
        expect(toReport(row({ operator: Buffer.alloc(16) }), NAMES, NOW)?.punishedBy).toBeNull();
    });

    it("falls back to the UUID for a player the names table does not know", () => {
        expect(toReport(row({}), new Map(), NOW)?.playerName).toBe(PLAYER);
    });

    it("files a punishment with a scope under it, and the rest under the fallback", () => {
        expect(toReport(row({ scope: "survival" }), NAMES, NOW, "network")?.scopeKey).toBe("survival");
        expect(toReport(row({ scope: "" }), NAMES, NOW, "network")?.scopeKey).toBe("network");
    });

    it("skips a type this version does not know", () => {
        expect(toReport(row({ type: 9 }), NAMES, NOW)).toBeNull();
    });
});
