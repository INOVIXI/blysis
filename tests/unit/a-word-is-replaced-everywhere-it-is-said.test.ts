// @vitest-environment node
/**
 * An operator who calls the shop "Market" says so once.
 *
 * "Mağaza" is in the menu, the shop's heading, the cart, a dozen buttons and
 * the mails, and editing each line by hand is how a site ends up calling it
 * both. Replacing a word shows every string it would change first, as the
 * site says it now and as it would say it after, and writes only the ones the
 * operator kept. The text is worked out again on the server when it is
 * written, never taken from the browser, and a string the replacement would
 * break is refused by the same check a hand edit gets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row { id: string; locale: string; module: string; namespace: string; key: string; value: string; isCustom: boolean }

const { translation, transaction, ROWS } = vi.hoisted(() => {
    const ROWS: Row[] = [
        { id: "1", locale: "tr", module: "store", namespace: "store", key: "title", value: "Mağaza", isCustom: false },
        { id: "2", locale: "tr", module: "store", namespace: "store", key: "count", value: "{count} ürün Mağaza'da", isCustom: false },
        // Shipped by the store, worded over by the theme: the site never says "Mağaza" here.
        { id: "3", locale: "tr", module: "store", namespace: "store", key: "home", value: "Mağaza", isCustom: false },
        { id: "4", locale: "tr", module: "theme:kite", namespace: "store", key: "home", value: "Pazar yeri", isCustom: false },
    ];
    return {
        ROWS,
        translation: {
            findMany: vi.fn(async () => ROWS),
            upsert: vi.fn((args: unknown) => args),
            update: vi.fn((args: unknown) => args),
            delete: vi.fn((args: unknown) => args),
        },
        transaction: vi.fn(async (calls: unknown[]) => calls),
    };
});

// A change also leaves a version and marks the string's other languages,
// in the same write; neither is what these tests are about.
const LOOKED_AFTER = vi.hoisted(() => ({
    revision: { create: vi.fn((args: unknown) => args) },
    translationFlag: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn((args: unknown) => args),
        upsert: vi.fn((args: unknown) => args),
    },
}));

vi.mock("@/core/lib/db", () => ({
    prisma: { translation, ...LOOKED_AFTER, $transaction: transaction },
    default: { translation, ...LOOKED_AFTER, $transaction: transaction },
}));
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "admin" } }) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => true }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/i18n/translation-service", () => ({
    invalidateTranslationCache: async () => undefined,
    activeThemeId: async () => "kite",
}));
vi.mock("@/core/lib/i18n/shipped-value", () => ({
    shippedValue: (module: string, locale: string, namespace: string, key: string) =>
        ROWS.find((r) => r.module === module && r.locale === locale && r.namespace === namespace && r.key === key)?.value ?? null,
}));

import { POST } from "@/app/api/v1/admin/translations/replace/route";

interface Match { namespace: string; key: string; before: string; after: string; refused?: { reason: string } }

async function send(body: Record<string, unknown>) {
    const res = await POST(new Request("http://localhost/api/v1/admin/translations/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as never);
    return { status: res.status, body: await res.json() };
}

describe("replacing a word", () => {
    beforeEach(() => {
        translation.upsert.mockClear();
        transaction.mockClear();
    });

    it("shows every string the site says it in, before and after, and writes nothing", async () => {
        const { status, body } = await send({ find: "Mağaza", replace: "Market", locale: "tr" });
        expect(status).toBe(200);
        const matches = body.data.matches as Match[];
        expect(matches.map((m) => m.key)).toEqual(["count", "title"]);
        expect(matches.find((m) => m.key === "count")).toEqual({ namespace: "store", key: "count", before: "{count} ürün Mağaza'da", after: "{count} ürün Market'da" });
        expect(transaction).not.toHaveBeenCalled();
    });

    it("writes only what the operator kept, worked out again on the server", async () => {
        const { status, body } = await send({
            find: "Mağaza", replace: "Market", locale: "tr",
            apply: [{ namespace: "store", key: "title" }, { namespace: "store", key: "home" }],
        });
        expect(status).toBe(200);
        expect(body.data.changed).toBe(1);
        expect(translation.upsert).toHaveBeenCalledTimes(1);
        expect(translation.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ key: "title", module: "store", value: "Market", isCustom: true }),
        }));
    });

    it("refuses what would break a string, as a hand edit is refused, and writes none of it", async () => {
        const preview = await send({ find: "Mağaza", replace: "{shop}", locale: "tr" });
        expect((preview.body.data.matches as Match[]).map((m) => m.refused?.reason)).toEqual(["new_placeholder", "new_placeholder"]);
        const applied = await send({ find: "Mağaza", replace: "{shop}", locale: "tr", apply: [{ namespace: "store", key: "title" }] });
        expect(applied.status).toBe(400);
        expect(applied.body.code).toBe("translation_nothing_to_replace");
        expect(transaction).not.toHaveBeenCalled();
    });

    it("refuses an empty word and a language the site does not serve", async () => {
        expect((await send({ find: "", replace: "x", locale: "tr" })).status).toBe(400);
        expect((await send({ find: "a", replace: "x", locale: "xx" })).status).toBe(400);
    });
});
