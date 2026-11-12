/**
 * Reading a password hash that a site brought with it from somewhere else.
 *
 * A Minecraft community moving to Blysis usually brings its members from
 * AuthMe, the in-game login plugin, or from a web store that copied AuthMe's
 * table. Those rows hold AuthMe's SHA256 format, `$SHA$<salt>$<hash>`, and
 * without this every one of those members has to reset a password before
 * they can sign in, which on a large site is most of the people who would
 * have come back.
 *
 * It is verify-only on purpose. Nothing here makes such a hash, it is not on
 * the list in `hash-algorithms.ts`, and the setting that lets it be read is
 * off until an operator turns it on: two rounds of SHA-256 is a fast hash, and
 * a fast hash is the one an attacker with a copy of the table wants. A
 * successful sign-in replaces it with the site's own algorithm at once, so the
 * weak hash lasts exactly until its owner next types the password.
 */

import { createHash } from "node:crypto";
import { secretsMatch } from "@/core/lib/constant-time";

/**
 * `$SHA$`, a salt and a SHA-256 in hex. AuthMe's salt is 16 hex characters;
 * any run without a `$` is accepted, because the salt is only ever text that
 * is appended, and a copy made by another tool may have used another length.
 */
const AUTHME_SHA256 = /^\$SHA\$([^$]+)\$([0-9a-fA-F]{64})$/;

/** True for a hash in AuthMe's SHA256 format, whether or not it is accepted. */
export function isLegacyPasswordHash(hash: string): boolean {
    return AUTHME_SHA256.test(hash);
}

function sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Whether `password` is the one an AuthMe SHA256 hash was made from.
 *
 * AuthMe's own definition, in
 * `authme-core/src/main/java/fr/xephi/authme/security/crypts/Sha256.java`:
 *
 *     return "$SHA$" + salt + "$" + sha256(sha256(password) + salt);
 *
 * where `sha256` is the lowercase hex of the digest (`HashUtils.hash`). AuthMe
 * hashes the text with the JVM's default charset, which is UTF-8 on every
 * server its test vectors were made on and on any Java from 18; a row written
 * on an older server set to another charset, for a password with letters
 * outside ASCII, will not match here.
 */
export function legacyPasswordMatches(password: string, hash: string): boolean {
    const parts = AUTHME_SHA256.exec(hash);
    if (!parts) return false;
    const [, salt, expected] = parts;
    return secretsMatch(sha256Hex(sha256Hex(password) + salt), expected.toLowerCase());
}
