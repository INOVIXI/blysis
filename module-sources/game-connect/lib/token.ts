/**
 * Server tokens: made once, shown once, stored as a hash.
 *
 * A token is the whole of a game server's identity here, so it is treated the
 * way a password would be if passwords were random: 32 bytes from the system's
 * generator, and only the SHA-256 kept. A slow hash buys nothing for a value
 * with 256 bits of entropy, and the lookup has to be by hash anyway.
 */
import crypto from "crypto";

export const TOKEN_PREFIX = "gc_";

/** `gc_` and 43 base64url characters. */
const TOKEN_SHAPE = /^gc_[A-Za-z0-9_-]{43}$/;

export interface IssuedToken {
    token: string;
    hash: string;
    hint: string;
}

export function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function issueToken(): IssuedToken {
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
    return { token, hash: hashToken(token), hint: token.slice(-4) };
}

export function looksLikeToken(value: string): boolean {
    return TOKEN_SHAPE.test(value);
}

/** The token out of an `Authorization: Bearer` header, or null. */
export function bearerToken(header: string | null): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) return null;
    return looksLikeToken(match[1]) ? match[1] : null;
}

/** Compares two hex hashes without leaking where they differ. */
export function sameHash(a: string, b: string): boolean {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
