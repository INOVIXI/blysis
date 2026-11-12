// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A public setting's size limit holds whether the value arrives as a string
 * or as the JSON the screen built.
 *
 * The limits exist because these values are served to every visitor, and the
 * check read `rawValue.length` only when the value was a string. The footer
 * editor saves its columns and its hidden links as arrays, so the one key the
 * limit was written for went through it unmeasured, held back only by the
 * whole request's cap.
 */

const { setting, transaction } = vi.hoisted(() => ({
    setting: {
        findMany: vi.fn(async () => [] as unknown[]),
        upsert: vi.fn((args: unknown) => args),
    },
    transaction: vi.fn(async (calls: unknown[]) => calls),
}));

vi.mock("@/core/lib/db", () => ({
    prisma: { setting, $transaction: transaction },
    default: { setting, $transaction: transaction },
}));
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "admin" } }) }));
vi.mock("@/core/lib/permissions", () => ({
    isAdmin: async () => true,
    hasPermission: async () => true,
}));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/cache", () => ({ invalidate: async () => undefined }));
vi.mock("@/core/lib/email-config", () => ({ invalidateEmailConfig: () => undefined }));
vi.mock("@/core/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/core/generated/module-data", () => ({ ModuleSecretSettings: [], ModuleSettings: {} }));

import { PATCH } from "@/app/api/v1/settings/route";

function patch(body: unknown) {
    const request = new Request("http://localhost/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return PATCH(request as Parameters<typeof PATCH>[0]);
}

describe("a public setting sent as JSON", () => {
    beforeEach(() => transaction.mockClear());

    it("is refused past its limit, and nothing is written", async () => {
        const hidden = Array.from({ length: 900 }, (_, i) => `/a-page-${i}`);
        expect(JSON.stringify(hidden).length).toBeGreaterThan(8_000);

        const res = await patch({ footer_hidden_links: hidden });

        expect(res.status).toBe(400);
        expect(transaction).not.toHaveBeenCalled();
    });

    it("is saved within it", async () => {
        const res = await patch({ footer_hidden_links: ["/blog", "/forum"] });

        expect(res.status).toBe(200);
        expect(transaction).toHaveBeenCalledOnce();
    });
});

describe("a site's own words written in several languages", () => {
    beforeEach(() => transaction.mockClear());

    // The limit is on what a reader reads, which is one language at a time.
    // Measured as the JSON of all of them, a name in five languages was
    // refused as longer than a hundred characters.
    it("is measured one language at a time", async () => {
        const name = { default: "x".repeat(90), en: "y".repeat(90), de: "z".repeat(90), fr: "w".repeat(90) };
        expect(JSON.stringify(name).length).toBeGreaterThan(100);

        const res = await patch({ site_name: name });

        expect(res.status).toBe(200);
        expect(transaction).toHaveBeenCalledOnce();
    });

    it("is refused when one language is past the limit", async () => {
        const res = await patch({ site_name: { default: "Vanilya", en: "y".repeat(101) } });

        expect(res.status).toBe(400);
        expect(transaction).not.toHaveBeenCalled();
    });

    it("is stored as the reader will read it back, translations and all", async () => {
        const navbar = [
            { label: { default: "Kurallar", en: "Rules" }, href: "/rules" },
            { label: "Mağaza", labelKey: "store", href: "/store" },
        ];
        await patch({ navbar_links: navbar, site_name: { default: "Vanilya", en: "Vanilla", de: " " } });

        const written = Object.fromEntries(setting.upsert.mock.calls.map(([args]) => {
            const call = args as { where: { key: string }; create: { value: unknown } };
            return [call.where.key, call.create.value];
        }));
        expect(written.navbar_links).toEqual(navbar);
        // A blank translation is no translation, and is not kept.
        expect(written.site_name).toEqual({ default: "Vanilya", en: "Vanilla" });
    });

    it("is refused when it is not text at all", async () => {
        const res = await patch({ site_name: { en: "no original" } });

        expect(res.status).toBe(400);
        expect(transaction).not.toHaveBeenCalled();
    });
});

describe("every setting served to visitors", () => {
    beforeEach(() => transaction.mockClear());

    // The list `/api/v1/public-settings` serves, read off the file that holds
    // it for the route and the root layout alike. Two of them, the languages
    // the site offers and the one it opens in, were added without a limit,
    // and thirteen older ones never had one, so each could carry a whole
    // request's 100KB into every visitor's answer.
    const source = fs.readFileSync(path.join(process.cwd(), "src/core/lib/public-settings.ts"), "utf8");
    const list = source.slice(source.indexOf("const PUBLIC_KEYS"), source.indexOf("];", source.indexOf("const PUBLIC_KEYS")));
    const keys = [...list.matchAll(/^\s+"([a-z0-9_]+)",/gm)].map((m) => m[1]);

    it("is read off the allowlist", () => {
        expect(keys).toContain("site_languages");
        expect(keys.length).toBeGreaterThan(20);
    });

    it("has a limit of its own, short of a whole request", async () => {
        const unbounded: string[] = [];
        // A stylesheet is the one public value meant to be large; its limit
        // is above a request, so the request's own cap is what holds it.
        for (const key of keys.filter((k) => k !== "custom_css")) {
            const res = await patch({ [key]: "x".repeat(60_000) });
            if (res.status !== 400) unbounded.push(key);
        }
        expect(unbounded).toEqual([]);
        expect(transaction).not.toHaveBeenCalled();
    });
});
