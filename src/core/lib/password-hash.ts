/**
 * Which algorithm hashes a password, and how the ones already hashed with the
 * other one keep working.
 *
 * An operator may choose. The list is short on purpose: bcrypt, which every
 * account on every existing install is already hashed with, and scrypt, which
 * is memory-hard and comes with Node rather than with a dependency. Nothing
 * weaker is on it - not because an operator would reach for MD5, but because
 * a dropdown is an endorsement, and a control that can silently make every
 * password on the site easier to crack is worse than no control. That is the
 * same rule the password minimum in `security-settings.ts` follows: an
 * operator may tighten, never loosen.
 *
 * Argon2id is the one this would otherwise offer. It is not here because
 * every Node binding for it is a native module, and a hashing algorithm that
 * fails to build is a site nobody can sign in to. That is a dependency
 * decision rather than a detail, so it stays a decision to be made rather than
 * one made quietly here.
 *
 * The whole risk of the feature is one sentence: changing the setting must not
 * lock anybody out. An account holds a hash made by whichever algorithm was
 * configured when its password was last set, and the setting is not a
 * migration. So a hash says what made it, verification reads the hash rather
 * than the setting, and the setting decides only what the next hash is made
 * with.
 *
 * The upgrade path is the login. A password exists in this process for exactly
 * one moment - when somebody types it - so that is the only moment an old hash
 * can be replaced. `needsRehash` marks the ones to rewrite then.
 *
 * One more format is read and never written: the hashes a site imported from
 * an older system, which an operator has to switch on. Why it is not on the
 * list above, and how it is read, is in `legacy-password-hash.ts`.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import bcrypt from "bcryptjs";
import { BCRYPT_ROUNDS } from "@/core/lib/constants";
import type { HashAlgorithm } from "@/core/lib/hash-algorithms";
import { isLegacyPasswordHash, legacyPasswordMatches } from "@/core/lib/legacy-password-hash";
import { legacyPasswordHashesAccepted } from "@/core/lib/security-settings";

// Re-exported so a server caller has one import rather than two. A client
// component takes the list from `hash-algorithms.ts` directly.
export { DEFAULT_ALGORITHM, HASH_ALGORITHMS, isHashAlgorithm, type HashAlgorithm } from "@/core/lib/hash-algorithms";

/**
 * Written out rather than promisified: `promisify` resolves to the three
 * argument overload, and the options are where the cost parameters live.
 */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
    });
}

/**
 * OWASP's floor for scrypt, which is what these mean: N is the cost, r the
 * block size and p the parallelism. Written into every hash so raising them
 * later does not strand the passwords hashed under the old ones.
 */
const SCRYPT_COST = 2 ** 16;
const SCRYPT_BLOCK = 8;
const SCRYPT_PARALLEL = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
/** Node's default is 32 MB, which is under what N=65536, r=8 needs. */
const SCRYPT_MEMORY = 192 * 1024 * 1024;

/**
 * Which algorithm made a stored hash, or null when nothing here did.
 *
 * bcrypt's prefixes are its own (`$2a$`, `$2b$`, `$2y$`); the scrypt encoding
 * below borrows the same shape and its own name, so the two can never be
 * mistaken for one another however the column is read.
 */
function algorithmOf(hash: string): HashAlgorithm | null {
    if (/^\$2[aby]\$/.test(hash)) return "bcrypt";
    if (hash.startsWith("$scrypt$")) return "scrypt";
    return null;
}

async function scryptHash(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const key = await scrypt(password, salt, SCRYPT_KEY_BYTES, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK,
        p: SCRYPT_PARALLEL,
        maxmem: SCRYPT_MEMORY,
    });
    const params = `N=${SCRYPT_COST},r=${SCRYPT_BLOCK},p=${SCRYPT_PARALLEL}`;
    return `$scrypt$${params}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function scryptVerify(password: string, hash: string): Promise<boolean> {
    const parts = hash.split("$");
    // ["", "scrypt", params, salt, key]
    if (parts.length !== 5) return false;
    const [, , params, saltB64, keyB64] = parts;

    const read = (name: string): number | null => {
        const found = params.split(",").find((pair) => pair.startsWith(`${name}=`));
        if (!found) return null;
        const value = Number(found.slice(name.length + 1));
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    };
    const cost = read("N");
    const block = read("r");
    const parallel = read("p");
    if (cost === null || block === null || parallel === null) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
        salt = Buffer.from(saltB64, "base64");
        expected = Buffer.from(keyB64, "base64");
    } catch {
        return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;

    let actual: Buffer;
    try {
        actual = await scrypt(password, salt, expected.length, {
            N: cost,
            r: block,
            p: parallel,
            maxmem: SCRYPT_MEMORY,
        });
    } catch {
        // Parameters a stored hash claims but this machine will not run. It is
        // not a match, and it is not a crash on the login route either.
        return false;
    }
    return timingSafeEqual(actual, expected);
}

/**
 * An unknown name falls back to bcrypt rather than throwing: a typo in a
 * settings row is not a reason for nobody to be able to register.
 */
export async function hashPassword(password: string, algorithm: HashAlgorithm): Promise<string> {
    if (algorithm === "scrypt") return scryptHash(password);
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * False for anything this file did not write, rather than a thrown error, and
 * for an imported hash while the site does not accept them. The setting is
 * read only for such a hash, so every other sign-in costs what it did.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    if (isLegacyPasswordHash(hash)) {
        return (await legacyPasswordHashesAccepted()) && legacyPasswordMatches(password, hash);
    }
    const algorithm = algorithmOf(hash);
    if (algorithm === "scrypt") return scryptVerify(password, hash);
    if (algorithm === "bcrypt") {
        try {
            return await bcrypt.compare(password, hash);
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * True when a stored hash should be rewritten at the next successful login.
 *
 * Always true for an imported hash: it is read only so that it can be
 * replaced. False for a hash nothing here recognises: there is nothing to
 * compare it against, and rewriting one on a login would be trusting a
 * password check that did not happen.
 */
export function needsRehash(hash: string, wanted: HashAlgorithm): boolean {
    if (isLegacyPasswordHash(hash)) return true;
    const algorithm = algorithmOf(hash);
    if (algorithm === null) return false;
    return algorithm !== wanted;
}
