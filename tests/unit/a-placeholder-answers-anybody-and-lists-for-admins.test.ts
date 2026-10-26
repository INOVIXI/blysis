// @vitest-environment node
/**
 * The two doors to the site placeholders.
 *
 * The values are public: the page that shows them is, so the endpoint answers
 * anybody, waits longer than a page render can, and is rate limited like the
 * rest of the public API. The list of what there is, with each one's label
 * key and example, is the panel's, for the picker beside a text an operator
 * writes, so it is the panel's to ask.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
    session: null as { user: { id: string; role?: string } } | null,
    admin: false,
    budget: 0,
    limited: false,
}));

vi.mock("@/core/lib/auth", () => ({ auth: async () => state.session }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => state.admin }));
vi.mock("@/core/lib/rate-limit", () => ({
    getClientIP: () => "127.0.0.1",
    rateLimits: { api: { maxRequests: 100, windowMs: 60000 } },
    rateLimit: async () => ({ success: !state.limited, remaining: 1, resetAt: Date.now() + 1000 }),
}));
vi.mock("@/core/lib/placeholders", () => ({
    resolvePlaceholders: async ({ budgetMs }: { budgetMs: number }) => {
        state.budget = budgetMs;
        return { values: { "servers.online": 214, "site.name": "Kayadibi" }, pending: ["servers.max"] };
    },
    placeholderSources: async () => [
        { name: "site.name", module: "core", labelKey: "placeholder_site_name", example: null, maxAgeSeconds: 300, loader: async () => ({ default: async () => "x" }) },
        { name: "servers.online", module: "servers", labelKey: "placeholder_servers_online", example: "214", maxAgeSeconds: 20, loader: async () => ({ default: async () => 1 }) },
    ],
}));

const { GET: publicGET } = await import("@/app/api/v1/placeholders/route");
const { GET: adminGET } = await import("@/app/api/v1/admin/placeholders/route");

const request = (path: string) => new NextRequest(`http://site.test${path}`);

beforeEach(() => {
    state.session = null;
    state.admin = false;
    state.limited = false;
});

describe("the values", () => {
    it("answer anybody, after waiting longer than a page can", async () => {
        const response = await publicGET(request("/api/v1/placeholders"));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ values: { "servers.online": 214, "site.name": "Kayadibi" } });
        expect(state.budget).toBeGreaterThanOrEqual(2000);
    });

    it("are rate limited", async () => {
        state.limited = true;
        expect((await publicGET(request("/api/v1/placeholders"))).status).toBe(429);
    });
});

describe("the list", () => {
    it("is the panel's", async () => {
        expect((await adminGET()).status).toBe(401);
        state.session = { user: { id: "u1" } };
        expect((await adminGET()).status).toBe(403);
    });

    it("names each with its label key, its example and its value now", async () => {
        state.session = { user: { id: "u1" } };
        state.admin = true;
        const response = await adminGET();
        expect(await response.json()).toEqual({
            placeholders: [
                { name: "site.name", module: "core", labelKey: "placeholder_site_name", example: null, value: "Kayadibi" },
                { name: "servers.online", module: "servers", labelKey: "placeholder_servers_online", example: "214", value: 214 },
            ],
        });
    });
});
