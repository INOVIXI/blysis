// @vitest-environment node
/**
 * A public demo lets a visitor use the product, and keeps it usable for the
 * next one.
 *
 * Refusing every write makes a screenshot gallery; refusing nothing makes a
 * wasteland by Tuesday. So the rule is a list, and a list with ninety modules
 * behind it rots unless something reads it: the one this replaced matched
 * `/api/v1/two-factor/`, which nothing serves - the module mounts at
 * `/api/v1/auth/two-factor/` - so a visitor could put a second factor on the
 * shared account and walk away with the demo. Maintenance mode, the rate
 * limits, the roles and the translations were not on it at all.
 *
 * Two halves. The first names what must be refused and why, in the words a
 * person would use. The second is the census: every endpoint in the tree that
 * can be written to is either refused or named below as safe, so a new one
 * cannot appear without somebody ruling on it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEMO_REFUSES, isBlockedInDemo } from "@/core/lib/demo-guard";

const ROOT = process.cwd();

/** What one visitor must not be able to do to the next one's demo. */
const MUST_REFUSE: [string, string, string][] = [
    ["POST", "/api/v1/admin/maintenance", "closing the site"],
    ["POST", "/api/v1/admin/rate-limits", "refusing every request"],
    ["DELETE", "/api/v1/roles/admin-role-id", "deleting the role that opens the panel"],
    ["PATCH", "/api/v1/roles/admin-role-id", "taking the panel's permissions off it"],
    ["PATCH", "/api/v1/admin/translations", "rewriting every string on the site"],
    ["POST", "/api/v1/auth/two-factor/setup", "locking the shared account"],
    ["POST", "/api/v1/auth/setup", "the same, under the other name it answers to"],
    ["POST", "/api/v1/url-redirects", "moving the front page elsewhere"],
    ["POST", "/api/v1/admin/alerting", "pointing this server at an address of their choosing"],
    ["POST", "/api/v1/admin/alerting/test", "and firing it"],
    ["POST", "/api/v1/discord/test-send", "the same, through a module"],
    ["PUT", "/api/v1/minecraft-litebans/admin/connection", "a database this server dials"],
    ["POST", "/api/v1/external-data/admin/sources", "the same, with credentials"],
    ["POST", "/api/v1/storage/cloudflare-r2/settings", "where uploads go"],
    ["POST", "/api/v1/security/turnstile/settings", "the captcha that guards registration"],
    ["POST", "/api/v1/admin/backup", "a dump on disk per press"],
    ["POST", "/api/v1/broadcasts", "mail to everybody"],
    ["POST", "/api/v1/api-keys", "a key that answers from outside this gate"],
    ["DELETE", "/api/v1/auth/profile/delete", "the account the next visitor uses"],
    ["POST", "/api/v1/settings", "the site's own name and switches"],
    ["POST", "/api/v1/admin/updates", "pulling an image and recreating this container"],
    ["POST", "/api/v1/rcon", "running a command on a game server somewhere else"],
    ["POST", "/api/v1/admin/cron", "rescheduling the jobs this site runs"],
    ["POST", "/api/v1/me/avatar", "an upload, which is disk like any other"],
    ["POST", "/api/v1/users", "making accounts nobody asked for"],
];

/** What a demo is for. A visitor doing these is the demo working. */
const SAFE_FAMILIES: { pattern: RegExp; why: string }[] = [
    { pattern: /^\/api\/v1\/(?:blog|forum|help|changelog|custom-pages|showcase|slider|popups|announcements|comparison-tables|seo\/pages)/, why: "content the demo exists to show somebody writing" },
    { pattern: /^\/api\/v1\/(?:store|products|orders|coupons|bulk-discounts|creator-codes|gift-codes|credit-packages|store-campaigns|community-goal|product-commands|product-variables|chest|cart|widget-stats)/, why: "the shop, minus the checkout, which is refused" },
    { pattern: /^\/api\/v1\/(?:tickets|suggestions|forms|vote|trophies|wheel|servers|staff|punishments|referral|licenses|license-keys|profile-posts|credits|currency|minecraft|discord\/(?!test-send)|in-app-notifications|notifications|activity-feed|messages|search)/, why: "a module doing its own job, on rows the reset puts back" },
    { pattern: /^\/api\/v1\/auth\/(?:profile|register|login|logout|forgot-password|reset-password|verify-email|resend|session|linked-accounts)/, why: "a member acting on their own account, minus the four that are refused" },
    { pattern: /^\/api\/v1\/(?:sessions|users\/me|account)/, why: "the same" },
    { pattern: /^\/api\/v1\/themes\/[^/]+\/(?:customization|settings)/, why: "per-mode colour tokens, which the reset puts back" },
    { pattern: /^\/api\/v1\/(?:webhook|webhooks)\//, why: "a provider calling in, authenticated by its own signature rather than by a session" },
    { pattern: /^\/api\/v1\/(?:birfatura|parasut|iyzico|paytr|param|stripe|paypal|mollie|midtrans|razorpay|mercadopago|coinbase-commerce|coinpayments|nowpayments|paymentwall|paysafecard)/, why: "a gateway's own callback, the same" },
    { pattern: /^\/api\/v1\/(?:admin\/dev|admin\/moderation|admin\/warnings|moderation)/, why: "moderation of seeded rows, which the reset puts back" },
    { pattern: /^\/api(?:\/v1)?\/setup/, why: "answered only while setup is incomplete, which a demo never is" },
    { pattern: /^\/api\/v1\/a\/b$/, why: "the module dispatcher: it forwards, and the proxy has already read the real path" },
    { pattern: /^\/api\/v1\/(?:error-report|notification-preferences)$/, why: "a browser reporting its own trouble, and a member's own switches" },
    { pattern: /^\/api\/v1\/downloads/, why: "content the demo exists to show somebody managing" },
    { pattern: /^\/api\/v1\/admin\/trophies/, why: "the same, and reloading them only re-reads rows the reset puts back" },
];

/** Every path in the tree that answers a mutating verb. */
function writableEndpoints(): { path: string; methods: string[]; owner: string }[] {
    const WRITE = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/g;
    const out: { path: string; methods: string[]; owner: string }[] = [];

    const methodsIn = (file: string) =>
        [...new Set([...fs.readFileSync(file, "utf8").matchAll(WRITE)].map((m) => m[1]))];

    const walk = (dir: string, url: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full, `${url}/${entry.name}`); continue; }
            if (entry.name !== "route.ts") continue;
            const methods = methodsIn(full);
            if (methods.length) out.push({ path: url || "/", methods, owner: "core" });
        }
    };
    walk(path.join(ROOT, "src/app/api"), "/api");

    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        const manifest = path.join(ROOT, "module-sources", id, "module.json");
        if (!fs.existsSync(manifest)) continue;
        for (const route of JSON.parse(fs.readFileSync(manifest, "utf8")).api ?? []) {
            const handler = path.join(ROOT, "module-sources", id, route.handler ?? "");
            if (!fs.existsSync(handler)) continue;
            const methods = methodsIn(handler);
            if (methods.length) out.push({ path: `/api/v1${route.path}`, methods, owner: id });
        }
    }
    return out;
}

/** `[id]` is how a route declares itself; a rule sees a value there. */
const asRequested = (declared: string) => declared.replace(/\[\.\.\.[^\]]+\]/g, "a/b").replace(/\[[^\]]+\]/g, "x1");

describe("a demo refuses what would take it away from the next visitor", () => {
    for (const [method, url, what] of MUST_REFUSE) {
        it(`refuses ${what}`, () => {
            expect(isBlockedInDemo(method, url), `${method} ${url}`).toBe(true);
        });
    }

    it("says why, for every rule, because the next reader has to judge them", () => {
        const silent = DEMO_REFUSES.filter((rule) => !rule.why || rule.why.length < 12);
        expect(silent.map((rule) => String(rule.pattern))).toEqual([]);
    });

    it("refuses the same path with a trailing slash or a query string", () => {
        expect(isBlockedInDemo("POST", "/api/v1/admin/maintenance/")).toBe(true);
        expect(isBlockedInDemo("POST", "/api/v1/admin/maintenance?x=1")).toBe(true);
    });

    it("lets a visitor read anything", () => {
        expect(isBlockedInDemo("GET", "/api/v1/admin/maintenance")).toBe(false);
        expect(isBlockedInDemo("HEAD", "/api/v1/settings")).toBe(false);
    });
});

describe("a demo lets a visitor use the product", () => {
    it("allows the writes it exists to show", () => {
        const allowed = [
            ["POST", "/api/v1/blog/articles"],
            ["POST", "/api/v1/store/products"],
            ["PATCH", "/api/v1/forum/topics/x1"],
            ["POST", "/api/v1/tickets"],
            ["POST", "/api/v1/suggestions"],
        ] as const;
        for (const [method, url] of allowed) {
            expect(isBlockedInDemo(method, url), `${method} ${url}`).toBe(false);
        }
    });
});

describe("every endpoint that can be written to", () => {
    const endpoints = writableEndpoints();

    it("is found, all of it", () => {
        expect(endpoints.length).toBeGreaterThan(150);
    });

    it("is either refused in a demo or named here as safe", () => {
        const unruled: string[] = [];
        for (const { path: declared, methods, owner } of endpoints) {
            const url = asRequested(declared);
            const refused = methods.some((m) => isBlockedInDemo(m, url));
            if (refused) continue;
            if (SAFE_FAMILIES.some((family) => family.pattern.test(url))) continue;
            unruled.push(`${owner}: ${methods.join(",")} ${declared}`);
        }
        expect(
            unruled,
            "a demo has to have an answer for these: refuse them in demo-guard.ts, or add the family they belong to above with the reason they are safe",
        ).toEqual([]);
    });
});
