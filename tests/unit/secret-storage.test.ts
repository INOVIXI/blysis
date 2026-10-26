// @vitest-environment node
/**
 * Unit tests for src/core/lib/secret-storage.ts - AES-256-GCM at-rest secret
 * encryption. Pure crypto, no DB.
 *
 * The module caches the derived key in a module-level `cachedKey` and reads
 * env vars lazily inside getKey() on first use. To exercise the different
 * key-resolution branches (explicit env key, dev DATABASE_URL fallback,
 * production-missing-throw) we vi.resetModules() and re-import a fresh copy
 * with the desired env in place - otherwise the first test's cached key would
 * bleed into the rest.
 *
 * Coverage:
 *   - encrypt -> decrypt roundtrip equality (with explicit SECRET_ENCRYPTION_KEY)
 *   - tampered ciphertext (flipped auth tag / body) throws via the GCM tag
 *   - legacy plaintext passthrough + isEncrypted()
 *   - malformed v1 string throws
 *   - invalid key format throws
 *   - dev fallback derives a key from DATABASE_URL when no env key set
 *   - production + no key -> throws
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VALID_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock("@/core/lib/logger", () => ({
    log: { debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() },
}));

// Snapshot + restore env so cases don't leak into each other.
let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
    savedEnv = { ...process.env };
    vi.resetModules();
    logWarn.mockReset();
});
afterEach(() => {
    process.env = savedEnv;
    vi.restoreAllMocks();
});

async function loadWithEnv(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return import("@/core/lib/secret-storage");
}

describe("encryptSecret / decryptSecret roundtrip (explicit key)", () => {
    it("roundtrips an arbitrary string back to the original plaintext", async () => {
        const { encryptSecret, decryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: VALID_KEY,
        });
        const plain = "super-secret-rcon-password-🔐-with-unicode";
        const enc = encryptSecret(plain);
        expect(enc).not.toBe(plain);
        expect(enc.startsWith("v1:")).toBe(true);
        expect(decryptSecret(enc)).toBe(plain);
    });

    it("roundtrips an empty string", async () => {
        const { encryptSecret, decryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: VALID_KEY,
        });
        const enc = encryptSecret("");
        expect(decryptSecret(enc)).toBe("");
    });

    it("produces a distinct ciphertext each call (random IV) but both decrypt equal", async () => {
        const { encryptSecret, decryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: VALID_KEY,
        });
        const a = encryptSecret("same-input");
        const b = encryptSecret("same-input");
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe("same-input");
        expect(decryptSecret(b)).toBe("same-input");
    });

    it("isEncrypted reflects the v1 prefix", async () => {
        const { encryptSecret, isEncrypted } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: VALID_KEY,
        });
        expect(isEncrypted(encryptSecret("x"))).toBe(true);
        expect(isEncrypted("plain")).toBe(false);
    });
});

describe("tamper detection (GCM auth tag)", () => {
    it("throws when the auth tag is flipped", async () => {
        const { encryptSecret, decryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: VALID_KEY,
        });
        const enc = encryptSecret("integrity-matters");
        const [v, iv, tag, ct] = enc.split(":");
        // Flip the first hex nibble of the tag.
        const flipped = (tag[0] === "0" ? "1" : "0") + tag.slice(1);
        const tampered = [v, iv, flipped, ct].join(":");
        expect(() => decryptSecret(tampered)).toThrow();
    });

    it("throws when the ciphertext body is mutated", async () => {
        const { encryptSecret, decryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: VALID_KEY,
        });
        const enc = encryptSecret("integrity-matters-too");
        const [v, iv, tag, ct] = enc.split(":");
        const mutated = [v, iv, tag, (ct[0] === "0" ? "1" : "0") + ct.slice(1)].join(":");
        expect(() => decryptSecret(mutated)).toThrow();
    });

    it("throws when decrypted with a different key", async () => {
        const { encryptSecret } = await loadWithEnv({ SECRET_ENCRYPTION_KEY: VALID_KEY });
        const enc = encryptSecret("cross-key");
        vi.resetModules();
        const { decryptSecret } = await loadWithEnv({ SECRET_ENCRYPTION_KEY: "b".repeat(64) });
        expect(() => decryptSecret(enc)).toThrow();
    });
});

describe("legacy + malformed handling", () => {
    it("returns legacy plaintext (no v1 prefix) unchanged", async () => {
        const { decryptSecret } = await loadWithEnv({ SECRET_ENCRYPTION_KEY: VALID_KEY });
        expect(decryptSecret("legacy-plaintext-value")).toBe("legacy-plaintext-value");
    });

    it("throws on a malformed v1 string (wrong segment count)", async () => {
        const { decryptSecret } = await loadWithEnv({ SECRET_ENCRYPTION_KEY: VALID_KEY });
        expect(() => decryptSecret("v1:onlytwo:segments")).toThrow(/malformed/i);
    });
});

describe("key resolution branches", () => {
    it("throws when SECRET_ENCRYPTION_KEY is not 64 hex chars", async () => {
        const { encryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: "tooshort",
            NODE_ENV: "test",
        });
        expect(() => encryptSecret("x")).toThrow(/64 hex/i);
    });

    it("dev fallback derives a stable key from DATABASE_URL when no env key", async () => {
        const { encryptSecret, decryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: undefined,
            NODE_ENV: "development",
            DATABASE_URL: "postgresql://user:pass@localhost:5432/devdb",
        });
        const enc = encryptSecret("dev-secret");
        expect(decryptSecret(enc)).toBe("dev-secret");
        expect(logWarn).toHaveBeenCalled();
    });

    it("dev fallback throws when neither key nor DATABASE_URL is set", async () => {
        const { encryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: undefined,
            NODE_ENV: "development",
            DATABASE_URL: undefined,
        });
        expect(() => encryptSecret("x")).toThrow(/DATABASE_URL/);
    });

    it("production with no SECRET_ENCRYPTION_KEY throws (no silent fallback)", async () => {
        const { encryptSecret } = await loadWithEnv({
            SECRET_ENCRYPTION_KEY: undefined,
            NODE_ENV: "production",
            DATABASE_URL: "postgresql://user:pass@localhost:5432/proddb",
        });
        expect(() => encryptSecret("x")).toThrow(/required in production/i);
    });
});
