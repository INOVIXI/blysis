import { describe, expect, it } from "vitest";
import { NIL_UUID, offlineUuid, uuidBytes, uuidText } from "@/modules/minecraft-libertybans/lib/uuid";

/**
 * A server in offline mode makes a player's UUID out of the name they typed,
 * with Java's `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)`, and the member
 * lookup trusts a name only when the UUID is exactly that one. Got wrong by one
 * bit, no offline player is ever matched; so the expected values here are what
 * Java itself printed for these names, not what this file computes.
 *
 * And LibertyBans hands the UUID back as sixteen bytes on MariaDB and MySQL and
 * as text on PostgreSQL, so both have to come out spelled the same.
 */
describe("an offline UUID is the one the server made", () => {
    it("matches Java for a plain name", () => {
        expect(offlineUuid("Notch")).toBe("b50ad385-829d-3141-a216-7e7d7539ba7f");
    });

    it("is a different UUID for a different case, as on the server", () => {
        expect(offlineUuid("notch")).toBe("42653081-a90e-3475-b3d6-3550cdb43f8e");
    });

    it("hashes a name outside ASCII as UTF-8", () => {
        expect(offlineUuid("Kılıç")).toBe("1058db59-bb67-3a71-b4c0-183a647f2f57");
    });
});

describe("a UUID reads the same from either database", () => {
    const text = "b50ad385-829d-3141-a216-7e7d7539ba7f";

    it("reads sixteen bytes from MariaDB as the dashed spelling", () => {
        expect(uuidText(uuidBytes(text))).toBe(text);
    });

    it("reads PostgreSQL's text, in any case and with or without dashes", () => {
        expect(uuidText(text.toUpperCase())).toBe(text);
        expect(uuidText(text.replace(/-/g, ""))).toBe(text);
    });

    it("refuses what is not a UUID", () => {
        expect(uuidText(Buffer.alloc(4))).toBeNull();
        expect(uuidText("not-a-uuid")).toBeNull();
        expect(uuidText(null)).toBeNull();
    });

    it("spells the console and an address victim as the zero UUID", () => {
        expect(uuidText(Buffer.alloc(16))).toBe(NIL_UUID);
    });
});
