import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Twenty credentials used to sit in the settings table as plain text.
 *
 * The product shipped `secret-storage.ts` - AES-256-GCM, versioned, with a
 * migration path where a value written without the `v1:` prefix is read as
 * legacy plaintext so callers can encrypt on the next write - and exactly one
 * module used it. Every payment gateway read its key straight out of `Setting`
 * and used the string as it came. `/api/v1/settings` wrote what it was given
 * and had no notion of a setting being a secret at all, then handed the same
 * values back to the browser on every visit to a settings screen. So a Stripe
 * secret key, a PayPal client secret and eighteen more lived in a column any
 * database dump carries, and this product makes those dumps itself.
 *
 * This file used to be a ratchet. It pinned the twenty and refused a
 * twenty-first, because encrypting them meant marking which settings are
 * secrets, encrypting on write, decrypting in every module's reader and
 * migrating what was already stored - and that touches the payment path, where
 * this repository says to escalate rather than guess.
 *
 * The decision was made and the work is done, so the ratchet is now a
 * guarantee. Each of the twenty is declared by the module that owns it, which
 * is what makes core encrypt it without ever naming a module. Two of them do
 * not look like credentials from the key name alone: `cloudflare_r2_config`
 * and `cloudflare_turnstile_config` are JSON blobs with the secret one level
 * down, and the first version of this gate matched on the key name and walked
 * straight past both. A gate that only sees the shape it was written for is
 * the thing it was written against, so the declaration addresses the field.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The twenty, as measured in the clear on 2026-09-07. */
const WAS_PLAINTEXT: Record<string, string> = {
    coinbase_api_key: "coinbase-commerce-gateway",
    coinbase_webhook_secret: "coinbase-commerce-gateway",
    coinpayments_ipn_secret: "coinpayments-gateway",
    iyzico_api_key: "iyzico-gateway",
    iyzico_secret_key: "iyzico-gateway",
    mercadopago_access_token: "mercadopago-gateway",
    mercadopago_webhook_secret: "mercadopago-gateway",
    mollie_api_key: "mollie-gateway",
    nowpayments_api_key: "nowpayments-gateway",
    nowpayments_ipn_secret: "nowpayments-gateway",
    param_client_password: "param-gateway",
    paymentwall_secret_key: "paymentwall-gateway",
    paypal_client_secret: "paypal-gateway",
    paysafecard_api_key: "paysafecard-gateway",
    razorpay_key_secret: "razorpay-gateway",
    razorpay_webhook_secret: "razorpay-gateway",
    stripe_secret_key: "stripe-gateway",
    stripe_webhook_secret: "stripe-gateway",
    "cloudflare_r2_config.secretKey": "cloudflare-r2",
    "cloudflare_turnstile_config.secretKey": "cloudflare-turnstile",
};

const LOOKS_LIKE_A_CREDENTIAL = /secret|password|token|api_key|apikey|private/i;

/** Keys core reads for itself. None of them is a credential. */
const CORE_OWN_KEYS = new Set(["legacy_password_hashes", "password_hash_algorithm", "password_min_length", "password_reset_expiry_minutes"]);

function tsFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (full.endsWith(path.join("src", "modules"))) continue;
            tsFiles(full, out);
        } else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
}

/** Every setting key named in a list or a lookup, wherever it is read. */
function settingKeysRead(): Map<string, string> {
    const found = new Map<string, string>();
    for (const file of [...tsFiles(path.join(ROOT, "module-sources")), ...tsFiles(path.join(ROOT, "src"))]) {
        const body = fs.readFileSync(file, "utf8");
        if (!/prisma\.setting|readSettingValues|readSettingStrings/.test(body)) continue;
        for (const m of body.matchAll(/key:\s*\{\s*in:\s*\[([^\]]*)\]/g)) {
            for (const k of m[1].matchAll(/"([^"]+)"/g)) {
                if (!found.has(k[1])) found.set(k[1], path.relative(ROOT, file));
            }
        }
        for (const m of body.matchAll(/key:\s*"([^"]+)"/g)) {
            if (!found.has(m[1])) found.set(m[1], path.relative(ROOT, file));
        }
        for (const m of body.matchAll(/readSetting(?:Values|Strings)\(\s*\[([^\]]*)\]/g)) {
            for (const k of m[1].matchAll(/"([^"]+)"/g)) {
                if (!found.has(k[1])) found.set(k[1], path.relative(ROOT, file));
            }
        }
    }
    return found;
}

/** Every credential path the installed modules declare. */
function declaredCredentials(): Map<string, string> {
    const out = new Map<string, string>();
    const sources = path.join(ROOT, "module-sources");
    for (const entry of fs.readdirSync(sources, { withFileTypes: true })) {
        const manifest = path.join(sources, entry.name, "module.json");
        if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
        const declared = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { secretSettings?: string[] })
            .secretSettings ?? [];
        for (const key of declared) out.set(key, entry.name);
    }
    return out;
}

describe("a credential kept in the settings table", () => {
    const read = settingKeysRead();
    const declared = declaredCredentials();

    it("finds the settings the product reads", () => {
        expect(read.size).toBeGreaterThan(40);
    });

    it("is declared by the module that owns it, so core can seal it", () => {
        const undeclared = Object.entries(WAS_PLAINTEXT)
            .filter(([key]) => !declared.has(key))
            .map(([key, owner]) => `${key}  (expected ${owner} to declare it)`);

        expect(
            undeclared,
            `These were in the clear and are meant to be encrypted at rest now.\n` +
            `A key core cannot see declared is a key core writes as typed:\n${undeclared.join("\n")}`,
        ).toEqual([]);
    });

    it("is declared by the module it belongs to, not by some other one", () => {
        const misplaced = Object.entries(WAS_PLAINTEXT)
            .filter(([key, owner]) => declared.has(key) && declared.get(key) !== owner)
            .map(([key, owner]) => `${key}: declared by ${declared.get(key)}, belongs to ${owner}`);
        expect(misplaced).toEqual([]);
    });

    it("has no successor sitting in the clear beside them", () => {
        // The ratchet, inverted. It used to say "do not add a twenty-first
        // plaintext credential"; it now says "a new one arrives declared".
        const undeclared = [...read.entries()]
            .filter(([key]) => LOOKS_LIKE_A_CREDENTIAL.test(key))
            .filter(([key]) => !CORE_OWN_KEYS.has(key))
            .filter(([key]) => !declared.has(key))
            .map(([key, file]) => `${key}  (${file})`);

        expect(
            undeclared,
            `A credential is being kept in the settings table without being\n` +
            `declared, which means core writes it exactly as an operator typed\n` +
            `it. Add it to the owning module's "secretSettings":\n${undeclared.join("\n")}`,
        ).toEqual([]);
    });

    // "Is a declared key still used?" is not asked here. Four of them are read
    // through a constant rather than a literal, so a scan of the read calls
    // reports them missing when they are not, and a-credential-field-declares-
    // itself.test.ts already answers the question against the module's whole
    // source. Two gates measuring one guarantee two different ways is how a
    // green change ends up red for a reason that is neither.
});
