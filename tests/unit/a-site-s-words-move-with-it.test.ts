// @vitest-environment node
/**
 * A site's own words move with it.
 *
 * An operator who reworded their site on a staging copy, or who moves to a
 * new server without the old database, had to type every edit again: the
 * translation editor could change a string but not hand one over. The site's
 * edits now leave as one file, and a file comes back in the way a word
 * replacement does: every string it would change is shown first as the site
 * says it now and as it would say it after, one the check would refuse is
 * shown and cannot be kept, and what is written is an ordinary edit, with a
 * version to take it back and the other languages asked to follow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { fakeTable } from "../modules/game-connect/fake-prisma";

const { SHIPPED } = vi.hoisted(() => ({
    SHIPPED: {
        "store/tr/store.title": "Mağaza",
        "store/en/store.title": "Store",
        "store/tr/store.count": "{count} ürün",
    } as Record<string, string>,
}));

vi.mock("@/core/lib/db", async () => {
    const { fakeTable: table, fakeTransaction: tx } = await import("../modules/game-connect/fake-prisma");
    const t = table(() => ({ isCustom: false, basis: null }));
    const r = table(() => ({ createdAt: new Date() }));
    const f = table(() => ({ createdAt: new Date() }));
    Object.assign(globalThis, { __moveTables: { t, r, f } });
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

import { GET as EXPORT } from "@/app/api/v1/admin/translations/export/route";
import { POST as IMPORT } from "@/app/api/v1/admin/translations/import/route";

type Tables = Record<"t" | "r" | "f", ReturnType<typeof fakeTable>>;
const tables = () => (globalThis as unknown as { __moveTables: Tables }).__moveTables;

const row = (id: string, locale: string, key: string, value: string, isCustom = false) =>
    ({ id, locale, module: "store", namespace: "store", key, value, isCustom, basis: null });

function send(body: unknown) {
    return IMPORT(new Request("http://localhost/api/v1/admin/translations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as never).then(async (res) => ({ status: res.status, body: await res.json() }));
}

const file = (strings: { namespace: string; key: string; locale: string; value: string }[]) =>
    ({ format: "site-words", version: 1, strings });

beforeEach(() => {
    const { t, r, f } = tables();
    t.table.rows = [
        row("1", "tr", "title", "Market", true),
        row("2", "en", "title", "Store"),
        row("3", "tr", "count", "{count} ürün"),
    ];
    r.table.rows = [];
    f.table.rows = [];
});

describe("the site's words, leaving", () => {
    it("are only what the site itself wrote, as a file to keep", async () => {
        const res = await EXPORT();
        expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="site-words-\d{4}-\d{2}-\d{2}\.json"$/);
        const body = await res.json();
        expect(body.format).toBe("site-words");
        expect(body.strings).toEqual([{ namespace: "store", key: "title", locale: "tr", value: "Market" }]);
    });
});

describe("a file of words, arriving", () => {
    it("shows what it would change, before and after, and writes nothing", async () => {
        const { status, body } = await send({ file: file([
            { namespace: "store", key: "title", locale: "en", value: "Shop" },
            { namespace: "store", key: "title", locale: "tr", value: "Market" },
            { namespace: "store", key: "gone", locale: "tr", value: "Eski" },
        ]) });
        expect(status).toBe(200);
        expect(body.data.changes).toEqual([{ namespace: "store", key: "title", locale: "en", before: "Store", after: "Shop" }]);
        expect(body.data.same).toBe(1);
        expect(body.data.unknown).toBe(1);
        expect(tables().t.table.rows.find((r) => r.id === "2")).toMatchObject({ value: "Store" });
    });

    it("shows what the check would refuse, and never writes it", async () => {
        const words = file([{ namespace: "store", key: "count", locale: "tr", value: "{total} ürün" }]);
        const preview = await send({ file: words });
        expect(preview.body.data.changes[0].refused.reason).toBe("new_placeholder");
        const applied = await send({ file: words, apply: [{ namespace: "store", key: "count", locale: "tr" }] });
        expect(applied.status).toBe(400);
        expect(applied.body.code).toBe("translation_nothing_to_import");
    });

    it("writes what the operator kept as an edit, with a version and the other languages asked", async () => {
        const res = await send({
            file: file([{ namespace: "store", key: "title", locale: "en", value: "Shop" }]),
            apply: [{ namespace: "store", key: "title", locale: "en" }],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.changed).toBe(1);
        expect(tables().t.table.rows.find((r) => r.id === "2")).toMatchObject({ value: "Shop", isCustom: true, basis: "Store" });
        const [version] = tables().r.table.rows as { data: { cause: string } }[];
        expect(version.data.cause).toBe("import");
        expect((tables().f.table.rows as { locale: string; reason: string }[]).map((f) => `${f.locale}:${f.reason}`)).toEqual(["tr:translate"]);
    });

    it("is refused when it is not a file of words", async () => {
        const res = await send({ file: { format: "something-else", strings: [] } });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("translation_file_invalid");
    });
});
