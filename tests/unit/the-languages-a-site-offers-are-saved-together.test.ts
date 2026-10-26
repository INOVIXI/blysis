// @vitest-environment node
/**
 * The languages a site offers and the one it opens in are saved together,
 * and only as a pair that can stand.
 *
 * Through the general settings endpoint either key would take anything: an
 * empty list, a language the software does not ship, a site told to open in
 * a language it had just stopped offering. The proxy reads both on every page
 * and would make the best of it, so the mistake would show up as a site that
 * quietly opened somewhere else. This route refuses such a pair by name and
 * writes neither half of it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { fakeTable } from "../modules/game-connect/fake-prisma";

vi.mock("@/core/lib/db", async () => {
    const { fakeTable: table, fakeTransaction: tx } = await import("../modules/game-connect/fake-prisma");
    const setting = table();
    Object.assign(globalThis, { __settingTable: setting });
    const client = { setting };
    const prisma = { ...client, $transaction: tx(client, [setting.table]) };
    return { prisma, default: prisma };
});
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "admin" } }) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => true }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/cache", () => ({ invalidate: async () => undefined }));

import { GET, PUT } from "@/app/api/v1/admin/languages/route";

const settings = () => (globalThis as unknown as { __settingTable: ReturnType<typeof fakeTable> }).__settingTable;

function put(body: unknown) {
    return PUT(new Request("http://localhost/api/v1/admin/languages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as never).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const stored = () => Object.fromEntries((settings().table.rows as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));

describe("saving the languages a site offers", () => {
    beforeEach(() => {
        settings().table.rows = [{ id: "s1", key: "default_locale", value: "en" }];
    });

    it("writes both, in the order the software lists them, and is read back so", async () => {
        const res = await put({ offered: ["tr", "en"], preferred: "tr" });
        expect(res.status).toBe(200);
        expect(stored()).toEqual({ default_locale: "tr", site_languages: ["en", "tr"] });
        const read = await (await GET()).json();
        expect(read.data).toEqual({ offered: ["en", "tr"], preferred: "tr" });
    });

    it("refuses a site that would open in a language it does not offer, and writes neither", async () => {
        const res = await put({ offered: ["tr"], preferred: "en" });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("languages_default_not_offered");
        expect(stored()).toEqual({ default_locale: "en" });
    });

    it("refuses no language at all, and one the software does not ship", async () => {
        expect((await put({ offered: [], preferred: "en" })).body.code).toBe("languages_invalid");
        expect((await put({ offered: ["xx"], preferred: "xx" })).status).toBe(400);
        expect(stored()).toEqual({ default_locale: "en" });
    });
});
