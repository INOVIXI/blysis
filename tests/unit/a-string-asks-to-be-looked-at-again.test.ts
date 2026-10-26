// @vitest-environment node
/**
 * A string asks to be looked at again when what it was written against moved.
 *
 * Two ways a site's words fall out of step without anybody noticing. An
 * update ships a new original under a string the operator had reworded, and
 * the edit goes on standing in for words that are no longer the ones it
 * replaced. Or the operator rewords the Turkish and the English beside it
 * still says what the Turkish used to. The first is flagged by the seeder
 * that brings the update in, the second by the edit itself, and each is
 * cleared by the operator looking: saving the language, keeping their words,
 * or saying the translation is still right.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { fakeTable } from "../modules/game-connect/fake-prisma";
import { reviewsDue } from "../../scripts/seed-translations";
import { lineOf } from "@/core/lib/i18n/translation-lines";

const { SHIPPED } = vi.hoisted(() => ({
    SHIPPED: {
        "store/tr/store.title": "Mağaza",
        "store/en/store.title": "Store",
        "store/de/store.title": "Laden",
    } as Record<string, string>,
}));

vi.mock("@/core/lib/db", async () => {
    const { fakeTable: table, fakeTransaction: tx } = await import("../modules/game-connect/fake-prisma");
    const t = table(() => ({ isCustom: false, basis: null }));
    const r = table(() => ({ createdAt: new Date() }));
    const f = table(() => ({ createdAt: new Date() }));
    Object.assign(globalThis, { __flagTables: { t, r, f } });
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
import { POST as MARK } from "@/app/api/v1/admin/translations/flags/route";

type Tables = Record<"t" | "r" | "f", ReturnType<typeof fakeTable>>;
const tables = () => (globalThis as unknown as { __flagTables: Tables }).__flagTables;

function call(handler: (req: never) => Promise<Response>, method: string, body: unknown) {
    return handler(new Request("http://localhost/api/v1/admin/translations", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as never).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const flags = () => (tables().f.table.rows as { locale: string; reason: string }[])
    .map((f) => `${f.locale}:${f.reason}`).sort();

const row = (locale: string, value: string, extra: Record<string, unknown> = {}) =>
    ({ id: locale, locale, module: "store", namespace: "store", key: "title", value, isCustom: false, basis: null, ...extra });

describe("a string changed in one language", () => {
    beforeEach(() => {
        const { t, r, f } = tables();
        t.table.rows = [row("tr", "Mağaza"), row("en", "Store"), row("de", "Laden")];
        r.table.rows = [];
        f.table.rows = [];
    });

    it("leaves every other language that says it awaiting translation", async () => {
        await call(PATCH, "PATCH", { namespace: "store", key: "title", values: { tr: "Market" } });
        expect(flags()).toEqual(["de:translate", "en:translate"]);
    });

    it("clears what was asked of the language that was saved", async () => {
        tables().f.table.rows = [
            { id: "f1", locale: "en", namespace: "store", key: "title", reason: "translate" },
            { id: "f2", locale: "tr", namespace: "store", key: "title", reason: "review" },
        ];
        await call(PATCH, "PATCH", { namespace: "store", key: "title", values: { en: "Shop", tr: "Mağaza" } });
        expect(flags()).toEqual(["de:translate"]);
    });

    it("remembers the original it was written against", async () => {
        await call(PATCH, "PATCH", { namespace: "store", key: "title", values: { tr: "Market" } });
        expect(tables().t.table.rows.find((r) => r.locale === "tr")).toMatchObject({ value: "Market", basis: "Mağaza" });
    });

    it("put back to what ships asks only of the languages the site reworded", async () => {
        tables().t.table.rows = [
            row("tr", "Market", { isCustom: true, basis: "Mağaza" }),
            row("en", "Market", { isCustom: true, basis: "Store" }),
            row("de", "Laden"),
        ];
        await call(DELETE, "DELETE", { namespace: "store", key: "title", locale: "tr" });
        expect(flags()).toEqual(["en:translate"]);
    });
});

describe("an update that changes an original under the site's edit", () => {
    const shipped = [
        { namespace: "store", key: "title", value: "Dükkan" },
        { namespace: "store", key: "cart", value: "Sepet" },
    ];

    it("is found by the seeder, and an edit it never saw is given its original", () => {
        const due = reviewsDue(shipped, [
            { id: "a", namespace: "store", key: "title", basis: "Mağaza" },
            { id: "b", namespace: "store", key: "cart", basis: null },
            { id: "c", namespace: "store", key: "gone", basis: "Eski" },
        ]);
        expect(due.review).toEqual([{ namespace: "store", key: "title" }]);
        expect(due.backfill).toEqual([{ id: "b", basis: "Sepet" }]);
    });

    it("asks nothing of an edit whose original did not move", () => {
        const due = reviewsDue(shipped, [{ id: "a", namespace: "store", key: "cart", basis: "Sepet" }]);
        expect(due).toEqual({ review: [], backfill: [] });
    });

    it("shows the operator what the original said and says now", () => {
        const line = lineOf(
            { namespace: "store", key: "title" },
            [row("tr", "Market", { isCustom: true, basis: "Dükkan" })],
            ["tr"],
            [{ locale: "tr", namespace: "store", key: "title", reason: "review" }],
        );
        expect(line.locales.tr.review).toEqual({ was: "Dükkan", now: "Mağaza" });
        expect(line.locales.tr.awaiting).toBe(false);
    });
});

describe("the operator looking", () => {
    beforeEach(() => {
        const { t, f } = tables();
        t.table.rows = [row("tr", "Market", { isCustom: true, basis: "Dükkan" }), row("en", "Store")];
        f.table.rows = [
            { id: "f1", locale: "tr", namespace: "store", key: "title", reason: "review" },
            { id: "f2", locale: "en", namespace: "store", key: "title", reason: "translate" },
        ];
    });

    it("keeps their words against the new original", async () => {
        const res = await call(MARK, "POST", { namespace: "store", key: "title", locale: "tr", reason: "review" });
        expect(res.status).toBe(200);
        expect(flags()).toEqual(["en:translate"]);
        expect(tables().t.table.rows.find((r) => r.locale === "tr")).toMatchObject({ value: "Market", basis: "Mağaza" });
    });

    it("says a translation is still right", async () => {
        await call(MARK, "POST", { namespace: "store", key: "title", locale: "en", reason: "translate" });
        expect(flags()).toEqual(["tr:review"]);
    });

    it("is told when there was nothing to clear", async () => {
        const res = await call(MARK, "POST", { namespace: "store", key: "title", locale: "de", reason: "translate" });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("translation_flag_not_found");
    });
});
