// Symmetric AES-256-GCM encryption for at-rest secrets stored in the
// database (e.g. RCON passwords, third-party API tokens).
//
// Storage format
// --------------
//   v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
//
// The `v1:` prefix is a forward-compatible version tag so the key /
// algorithm can be rotated later without ambiguous decoder behaviour.
// Strings missing the prefix are treated as legacy plaintext by
// decryptSecret(), letting callers transparently migrate values on the
// next write - see TASK 3 in the schema-hardening pass.
//
// Key material
// ------------
//   SECRET_ENCRYPTION_KEY  → 64-char hex (32 raw bytes), required in
//                            production. Generate with:
//                              node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
//   In development the variable is optional: when missing we derive a
//   stable 32-byte key by SHA-256 hashing DATABASE_URL so dev databases
//   stay decryptable across restarts without forcing every contributor
//   to set the env var. Production missing-var throws to prevent a
//   silent fallback from leaking through into a deploy.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { log } from "@/core/lib/logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const KEY_LENGTH = 32; // 256 bits
const VERSION = "v1";

let cachedKey: Buffer | null = null;
let warnedDevFallback = false;

function getKey(): Buffer {
    if (cachedKey) return cachedKey;

    const fromEnv = process.env.SECRET_ENCRYPTION_KEY;
    if (fromEnv) {
        if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) {
            throw new Error(
                "SECRET_ENCRYPTION_KEY must be 64 hex characters (32 bytes). " +
                "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
            );
        }
        cachedKey = Buffer.from(fromEnv, "hex");
        return cachedKey;
    }

    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "SECRET_ENCRYPTION_KEY is required in production. " +
            "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        throw new Error(
            "Cannot derive dev encryption key: neither SECRET_ENCRYPTION_KEY nor DATABASE_URL is set."
        );
    }

    if (!warnedDevFallback) {
        log.warn(
            "[secret-storage] SECRET_ENCRYPTION_KEY is not set; deriving a key from DATABASE_URL for dev. " +
            "Set SECRET_ENCRYPTION_KEY before going to production."
        );
        warnedDevFallback = true;
    }

    cachedKey = createHash("sha256").update(dbUrl).digest();
    return cachedKey;
}

/**
 * Encrypt a plaintext secret for at-rest storage. Returns a self-contained
 * string that includes the version tag, IV, and auth tag. Always returns
 * a non-empty string for any non-empty input.
 */
export function encryptSecret(plain: string): string {
    if (typeof plain !== "string") {
        throw new TypeError("encryptSecret expects a string");
    }
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypt a value previously produced by `encryptSecret`. If the input
 * doesn't start with the version prefix it's assumed to be legacy
 * plaintext (e.g. a row written before encryption was rolled out) and
 * returned as-is. Callers should re-encrypt on next write to complete
 * the migration.
 */
export function decryptSecret(stored: string): string {
    if (typeof stored !== "string") {
        throw new TypeError("decryptSecret expects a string");
    }
    if (!stored.startsWith(`${VERSION}:`)) {
        // Legacy plaintext - accept once, caller should re-store encrypted.
        return stored;
    }
    const parts = stored.split(":");
    if (parts.length !== 4) {
        throw new Error("decryptSecret: malformed ciphertext (expected v1:iv:tag:ct)");
    }
    const [, ivHex, tagHex, ctHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ct = Buffer.from(ctHex, "hex");
    if (iv.length !== IV_LENGTH) {
        throw new Error("decryptSecret: invalid IV length");
    }
    if (key.length !== KEY_LENGTH) {
        throw new Error("decryptSecret: invalid key length");
    }
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf8");
}

/**
 * True if the stored value is already in the encrypted v1 format. Useful
 * for migration scripts and audit checks.
 */
export function isEncrypted(stored: string): boolean {
    return typeof stored === "string" && stored.startsWith(`${VERSION}:`);
}
