// @vitest-environment node
/**
 * A change to the site's words can be taken back.
 *
 * An operator who rewords the shop, restores a string or replaces a word
 * across the site had no way back but to remember what it said and type it
 * in again: the editor kept only the current text, and a restore threw the
 * edit away for good. Every change now leaves a version behind in the same
 * write, saying what each language it touched said before, and putting one
 * back is a change of its own, so it can be taken back too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { fakeTable } from "../modules/game-connect/fake-prisma";

const { SHIPPED } = vi.hoisted(() => ({
    SHIPPED: {
        "store/tr/store.title": "Mağaza",
        "store/en/store.title": "Store",
    } as Record<string, string>,
}));

vi.mock("@/core/lib/db", async () => {
    const { fakeTable: table, fakeTransaction: tx } = await import("../modules/game-connect/fake-prisma");
    const t = table(() => ({ isCustom: false, basis: null }));
    let at = 0;
    const r = table(() => ({ createdAt: new Date(1_000_000 + ++at) }));
    const f = table(() => ({ createdAt: new Date() }));
    Object.assign(globalThis, { __tables: { t, r, f } });
    const client = { translation: t, revision: r, translationFlag: f };
    const prisma = { ...client, $transaction: tx(client, [t.table, r.table, f.table]) };
    return { prisma, default: prisma };
});
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "admin" } }) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => true }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/i18n/translation-service", () => ({
    invalidateTranslationCache: async () => undefined,
    activeThemeId: async () => "kite",
}));
vi.mock("@/core/lib/i18n/shipped-value", () => ({
    shippedValue: (module: string, locale: string, namespace: string, key: string) =>
        SHIPPED[`${module}/${locale}/${namespace}.${key}`] ?? null,
}));

import { DELETE, PATCH } from "@/app/api/v1/admin/translations/route";
import { GET as HISTORY, POST as UNDO } from "@/app/api/v1/admin/translations/history/route";

const tables = () => (globalThis as unknown as { __tables: Record<"t" | "r" | "f", ReturnType<typeof fakeTable>> }).__tables;

function call(handler: (req: never) => Promise<Response>, method: string, body?: unknown, query = "") {
    return handler(new Request(`http://localhost/api/v1/admin/translations${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as never).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const said = (locale: string) =>
    tables().t.table.rows.find((r) => r.locale === locale && r.key === "title") as { value: string; isCustom: boolean };

describe("a change to a string", () => {
    beforeEach(() => {
        const { t, r, f } = tables();
        t.table.rows = [
            { id: "tr", locale: "tr", module: "store", namespace: "store", key: "title", value: "Mağaza", isCustom: false, basis: null },
            { id: "en", locale: "en", module: "store", namespace: "store", key: "title", value: "Store", isCustom: false, basis: null },
        ];
        r.table.rows = [];
        f.table.rows = [];
    });

    it("leaves a version saying what the language it touched said before", async () => {
        await call(PATCH, "PATCH", { namespace: "store", key: "title", values: { tr: "Market" } });
        const [version] = tables().r.table.rows as { resource: string; resourceId: string; authorId: string; data: { cause: string; locales: Record<string, unknown> } }[];
        expect(version.resource).toBe("translation");
        expect(version.resourceId).toBe("store:title");
        expect(version.authorId).toBe("u1");
        expect(version.data).toEqual({ cause: "edit", locales: { tr: { value: "Mağaza", isCustom: false } } });
    });

    it("can be taken back, and the taking back is a version of its own", async () => {
        await call(PATCH, "PATCH", { namespace: "store", key: "title", values: { tr: "Market" } });
        expect(said("tr")).toMatchObject({ value: "Market", isCustom: true });

        const listed = await call(HISTORY, "GET", undefined, "/history?namespace=store&key=title");
        expect(listed.status).toBe(200);
        const [edit] = listed.body.data.items as { id: string; cause: string }[];
        expect(edit.cause).toBe("edit");

        const undone = await call(UNDO, "POST", { id: edit.id });
        expect(undone.status).toBe(200);
        expect(said("tr")).toMatchObject({ value: "Mağaza", isCustom: false });

        const after = await call(HISTORY, "GET", undefined, "/history?namespace=store&key=title");
        expect((after.body.data.items as { cause: string }[]).map((v) => v.cause)).toEqual(["undo", "edit"]);
    });

    it("brings back an edit a restore threw away", async () => {
        await call(PATCH, "PATCH", { namespace: "store", key: "title", values: { tr: "Market" } });
        await call(DELETE, "DELETE", { namespace: "store", key: "title" });
        expect(said("tr")).toMatchObject({ value: "Mağaza", isCustom: false });

        const listed = await call(HISTORY, "GET", undefined, "/history?namespace=store&key=title");
        const restore = (listed.body.data.items as { id: string; cause: string }[]).find((v) => v.cause === "restore");
        await call(UNDO, "POST", { id: restore?.id });
        expect(said("tr")).toMatchObject({ value: "Market", isCustom: true });
    });

    it("says so when the version asked for is not kept", async () => {
        const undone = await call(UNDO, "POST", { id: "gone" });
        expect(undone.status).toBe(404);
        expect(undone.body.code).toBe("translation_history_not_found");
    });
});
