// @vitest-environment node
/**
 * Which algorithm hashes a password, and what happens to the ones already
 * hashed with the other.
 *
 * An operator may now choose. The list is short on purpose: bcrypt, which
 * every account on every existing install is already hashed with, and scrypt,
 * which is memory-hard and comes with Node rather than with a dependency.
 * Nothing weaker is offered - not because an operator would pick it, but
 * because a dropdown is an endorsement, and a setting that can silently make
 * every password on the site easier to crack is worse than no setting.
 *
 * The whole risk of the feature is in one sentence: **changing the setting
 * must not lock anybody out.** Every account holds a hash made by whichever
 * algorithm was configured the day its password was last set, and the setting
 * is not a migration. So a hash says what made it, verification reads that
 * rather than the setting, and the setting decides only what the next hash is
 * made with.
 *
 * The upgrade path is the login itself. A password is only in the process at
 * one moment - when somebody types it - so that is the only moment an old hash
 * can be replaced with a new one. `needsRehash` marks the ones to rewrite, and
 * it says no when the stored hash already matches, because rewriting a hash on
 * every login is a database write on every login.
 *
 * A refused algorithm falls back to bcrypt rather than throwing. A typo in a
 * settings row is not a reason for nobody to be able to register.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    DEFAULT_ALGORITHM,
    HASH_ALGORITHMS,
    hashPassword,
    isHashAlgorithm,
    needsRehash,
    verifyPassword,
} from "@/core/lib/password-hash";

const PASSWORD = "correct horse battery staple";

describe("the algorithms on offer", () => {
    it("names bcrypt and scrypt and nothing else", () => {
        expect([...HASH_ALGORITHMS]).toEqual(["bcrypt", "scrypt"]);
    });

    it("defaults to the one every existing account already uses", () => {
        expect(DEFAULT_ALGORITHM).toBe("bcrypt");
    });

    it("refuses a name that is not on the list", () => {
        expect(isHashAlgorithm("bcrypt")).toBe(true);
        expect(isHashAlgorithm("scrypt")).toBe(true);
        expect(isHashAlgorithm("md5")).toBe(false);
        expect(isHashAlgorithm("sha1")).toBe(false);
        expect(isHashAlgorithm("plaintext")).toBe(false);
        expect(isHashAlgorithm(undefined)).toBe(false);
    });
});

/**
 * How long a test that hashes a password three times is given.
 *
 * Being slow on purpose is the whole point of a password hash, and these
 * cases pay for it three times over. Vitest's default ceiling is five
 * seconds; measured on this machine at a load average of 31, two of them
 * crossed it and the file went red for a reason that has nothing to do with
 * hashing. The work factor is the operator's and may be raised, which would
 * make this slower still.
 */
const ROOM_FOR_A_WORK_FACTOR = 30_000;

describe("hashing and reading back", () => {
    for (const algorithm of HASH_ALGORITHMS) {
        it(`round-trips a password through ${algorithm}`, async () => {
            const hash = await hashPassword(PASSWORD, algorithm);
            expect(await verifyPassword(PASSWORD, hash)).toBe(true);
            expect(await verifyPassword(PASSWORD + "x", hash)).toBe(false);
        }, ROOM_FOR_A_WORK_FACTOR);

        it(`salts every ${algorithm} hash, so two accounts do not share one`, async () => {
            const first = await hashPassword(PASSWORD, algorithm);
            const second = await hashPassword(PASSWORD, algorithm);
            expect(first).not.toBe(second);
            expect(await verifyPassword(PASSWORD, second)).toBe(true);
        }, ROOM_FOR_A_WORK_FACTOR);

        it(`writes a ${algorithm} hash that says what made it`, async () => {
            const hash = await hashPassword(PASSWORD, algorithm);
            expect(hash.startsWith("$")).toBe(true);
            expect(hash).not.toContain(PASSWORD);
        });
    }

    it("falls back to bcrypt rather than throwing on an unknown name", async () => {
        const hash = await hashPassword(PASSWORD, "md5" as never);
        expect(await verifyPassword(PASSWORD, hash)).toBe(true);
        expect(needsRehash(hash, "bcrypt")).toBe(false);
    });
});

describe("an account hashed with the other algorithm", () => {
    it("still signs in after the setting changes", async () => {
        const old = await hashPassword(PASSWORD, "bcrypt");
        // The site is now set to scrypt. The stored hash has not moved.
        expect(await verifyPassword(PASSWORD, old)).toBe(true);
    });

    it("signs in the other way round too", async () => {
        const old = await hashPassword(PASSWORD, "scrypt");
        expect(await verifyPassword(PASSWORD, old)).toBe(true);
    });

    it("is marked for rewriting at the next login", async () => {
        const old = await hashPassword(PASSWORD, "bcrypt");
        expect(needsRehash(old, "scrypt")).toBe(true);
    });

    it("is left alone when it already matches the setting", async () => {
        const current = await hashPassword(PASSWORD, "scrypt");
        expect(needsRehash(current, "scrypt")).toBe(false);
    });
});

describe("a hash that is not one of ours", () => {
    it("verifies nothing rather than throwing", async () => {
        for (const stored of ["", "not-a-hash", "$", "$scrypt$broken", "$argon2id$v=19$m=1"]) {
            expect(await verifyPassword(PASSWORD, stored)).toBe(false);
        }
    });

    it("is not offered for rewriting, because there is nothing to compare", () => {
        expect(needsRehash("not-a-hash", "bcrypt")).toBe(false);
        expect(needsRehash("", "scrypt")).toBe(false);
    });
});

/**
 * The other half of not locking anybody out, and the half a unit test of the
 * seam cannot reach.
 *
 * Six places compared a password against a stored hash, and reaching only five
 * of them is a site where a scrypt-hashed member can sign in, and then cannot
 * disable two-factor, change their password or close their account - each one
 * telling them their password is wrong. `verifyPassword` reads the hash, so
 * every one of them has to go through it.
 *
 * API keys are not passwords and are not here. They are hashed by the code
 * that issues them, verified by the code that checks them, and no operator
 * setting touches either.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const SEAM = "src/core/lib/password-hash.ts";
/** Issuing an API key, and checking one. Neither is a member's password. */
const API_KEYS = [
    "src/core/lib/api-key-auth.ts",
    "src/app/api/v1/api-keys/route.ts",
];

function sources(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sources(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe("every place a password is checked", () => {
    const files = ["src", "module-sources"].flatMap((dir) => sources(path.join(ROOT, dir)));

    it("finds the tree to scan", () => {
        expect(files.length).toBeGreaterThan(400);
    });

    it("goes through the one function that reads what made the hash", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const relative = path.relative(ROOT, file);
            if (relative === SEAM || API_KEYS.includes(relative)) continue;
            const source = fs.readFileSync(file, "utf8");
            if (/bcrypt\s*\.\s*(compare|hash)\s*\(/.test(source)) offenders.push(relative);
        }
        expect(
            offenders,
            `use verifyPassword / hashPassword from the SDK:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });
});
