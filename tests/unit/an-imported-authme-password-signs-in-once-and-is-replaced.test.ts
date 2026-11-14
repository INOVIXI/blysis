// @vitest-environment node
/**
 * A member brought over from AuthMe signs in with the password they already
 * had, and that sign-in is the last time their old hash is read.
 *
 * AuthMe stores `$SHA$<salt>$<sha256(sha256(password) + salt)>`. Without this
 * every imported member had to reset a password before coming back. It is a
 * fast hash, so reading it is off until an operator turns it on, and a
 * successful sign-in replaces it with the site's own algorithm before the
 * sign-in completes.
 *
 * The four vectors are AuthMe's own, from
 * `authme-core/src/test/java/fr/xephi/authme/security/crypts/Sha256Test.java`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    accepted: false,
    algorithm: "bcrypt" as "bcrypt" | "scrypt",
    writes: [] as { where: { id: string; password: string }; data: { password: string } }[],
    failWrite: false,
}));

vi.mock("@/core/lib/security-settings", () => ({
    legacyPasswordHashesAccepted: async () => state.accepted,
    getHashAlgorithm: async () => state.algorithm,
}));

vi.mock("@/core/lib/db", () => ({
    prisma: {
        user: {
            updateMany: async (args: (typeof state.writes)[number]) => {
                if (state.failWrite) throw new Error("database gone");
                state.writes.push(args);
                return { count: 1 };
            },
        },
    },
}));

import { isLegacyPasswordHash, legacyPasswordMatches } from "@/core/lib/legacy-password-hash";
import { hashPassword, needsRehash, verifyPassword } from "@/core/lib/password-hash";
import { upgradeStoredHash } from "@/core/lib/password-upgrade";

const AUTHME_VECTORS: [string, string][] = [
    ["password", "$SHA$11aa0706173d7272$dbba96681c2ae4e0bfdf226d70fbbc5e4ee3d8071faa613bc533fe8a64817d10"],
    ["PassWord1", "$SHA$3c72a18a29b08d40$8e50a7a4f69a80f4893dc921eac84bd74b3f9ebfa22908302c9965eac3aa45e5"],
    ["&^%te$t?Pw@_", "$SHA$584cea1cfab90030$adc006330e73d81e463fe02a4fe9b17bdbbcc05955bff72fb27cf2089f0b3859"],
    ["âË_3(íù*", "$SHA$0b503d90dd9949d4$ba70c330242e0daa9a154ec9f4cce7f01dd05aff489d37c653e36a507c74d84f"],
];

/** Bcrypt is slow on purpose; see the hashing test beside this one. */
const ROOM_FOR_A_WORK_FACTOR = 30_000;

beforeEach(() => {
    state.accepted = false;
    state.algorithm = "bcrypt";
    state.writes = [];
    state.failWrite = false;
});

describe("AuthMe's SHA256 format", () => {
    it("matches every one of AuthMe's own test vectors", () => {
        for (const [password, hash] of AUTHME_VECTORS) {
            expect(isLegacyPasswordHash(hash)).toBe(true);
            expect(legacyPasswordMatches(password, hash), password).toBe(true);
        }
    });

    it("refuses a wrong password, a changed salt and a changed digest", () => {
        const [password, hash] = AUTHME_VECTORS[0];
        expect(legacyPasswordMatches(password + "x", hash)).toBe(false);
        expect(legacyPasswordMatches("Password", hash)).toBe(false);
        expect(legacyPasswordMatches(password, hash.replace("11aa", "11ab"))).toBe(false);
        expect(legacyPasswordMatches(password, hash.slice(0, -1) + "1")).toBe(false);
    });

    it("reads a digest written in capitals the same way", () => {
        const [password, hash] = AUTHME_VECTORS[1];
        const [, , salt, digest] = hash.split("$");
        expect(legacyPasswordMatches(password, `$SHA$${salt}$${digest.toUpperCase()}`)).toBe(true);
    });

    it("is not a shape that only looks like one", () => {
        for (const stored of ["$SHA$", "$SHA$salt$", "$SHA$salt$abc", "$SHA$a$b$" + "0".repeat(64), "$sha$11aa$" + "0".repeat(64)]) {
            expect(isLegacyPasswordHash(stored), stored).toBe(false);
        }
    });
});

describe("signing in with an imported hash", () => {
    it("is refused while the site has not turned it on", async () => {
        for (const [password, hash] of AUTHME_VECTORS) {
            expect(await verifyPassword(password, hash)).toBe(false);
        }
    });

    it("works once the site accepts them, and only with the right password", async () => {
        state.accepted = true;
        for (const [password, hash] of AUTHME_VECTORS) {
            expect(await verifyPassword(password, hash)).toBe(true);
            expect(await verifyPassword(password + " ", hash)).toBe(false);
        }
    });

    it("is never left as it is", () => {
        expect(needsRehash(AUTHME_VECTORS[0][1], "bcrypt")).toBe(true);
        expect(needsRehash(AUTHME_VECTORS[0][1], "scrypt")).toBe(true);
    });

    it("is replaced before the sign-in finishes, with the site's own algorithm", async () => {
        state.accepted = true;
        const [password, hash] = AUTHME_VECTORS[0];
        await upgradeStoredHash("u1", password, hash);

        expect(state.writes).toHaveLength(1);
        const [write] = state.writes;
        // Only over the hash that was checked, so a newer password stays.
        expect(write.where).toEqual({ id: "u1", password: hash });
        expect(write.data.password.startsWith("$2")).toBe(true);
        expect(write.data.password).not.toContain(password);
        expect(isLegacyPasswordHash(write.data.password)).toBe(false);
        expect(await verifyPassword(password, write.data.password)).toBe(true);
    }, ROOM_FOR_A_WORK_FACTOR);

    it("lets the member in even when the replacing write fails", async () => {
        state.failWrite = true;
        await expect(upgradeStoredHash("u1", AUTHME_VECTORS[0][0], AUTHME_VECTORS[0][1])).resolves.toBeUndefined();
    }, ROOM_FOR_A_WORK_FACTOR);

    it("writes nothing for a hash already made the way the site wants", async () => {
        const current = await hashPassword("correct horse", "bcrypt");
        await upgradeStoredHash("u1", "correct horse", current);
        expect(state.writes).toEqual([]);
    }, ROOM_FOR_A_WORK_FACTOR);
});
