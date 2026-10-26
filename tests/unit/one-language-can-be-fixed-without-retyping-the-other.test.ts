// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the translation editor accepts over the wire.
 *
 * The screen puts every locale on one line so that leaving one alone is a
 * decision rather than an oversight, but it must stay a decision: an operator
 * correcting one word of English is not thereby required to retype the
 * Turkish. `z.record(z.enum(locales), ...)` in Zod 4 is exhaustive, so the
 * endpoint shipped demanding every locale in every save, and refused a
 * one-locale body with "expected string, received undefined" for the other.
 *
 * That refusal also hid the check this endpoint exists for. Measured against
 * a running build: a body naming a value the shipped string never named came
 * back 400 with no `code`, because the schema had rejected it before
 * `checkMessageEdit` ever saw it. A refusal with no code is a refusal the
 * screen cannot put into a sentence, so the operator was told nothing.
 */

const { translation, transaction } = vi.hoisted(() => ({
    translation: {
        // The string is core's, with a row in English only.
        findMany: vi.fn(async (args: { where?: { AND?: unknown[] } }) => args.where?.AND
            ? [{ id: "r1", locale: "en", module: "core", namespace: "admin", key: "known", value: "{count} orders", isCustom: false }]
            : []),
        upsert: vi.fn((args: unknown) => args),
        update: vi.fn((args: unknown) => args),
        delete: vi.fn((args: unknown) => args),
    },
    transaction: vi.fn(async (calls: unknown[]) => calls),
}));

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
    shippedValue: (_module: string, _locale: string, _namespace: string, key: string) =>
        key === "known" ? "{count} orders" : null,
}));

import { PATCH } from "@/app/api/v1/admin/translations/route";

interface Answer {
    status: number;
    body: { ok?: boolean; code?: string; details?: { locale?: string; names?: string[] } };
}

async function save(values: Record<string, string>, key = "known"): Promise<Answer> {
    const res = await PATCH(
        new Request("http://localhost/api/v1/admin/translations", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ namespace: "admin", key, values }),
        }) as never,
    );
    return { status: res.status, body: await res.json() };
}

describe("saving one string", () => {
    beforeEach(() => {
        translation.findMany.mockClear();
        translation.upsert.mockClear();
        transaction.mockClear();
    });

    it("takes one locale on its own", async () => {
        const answer = await save({ en: "{count} orders today" });
        expect(answer.status).toBe(200);
        expect(translation.upsert).toHaveBeenCalledTimes(1);
    });

    it("takes every locale at once", async () => {
        const answer = await save({ en: "{count} orders", tr: "{count} siparis" });
        expect(answer.status).toBe(200);
        expect(translation.upsert).toHaveBeenCalledTimes(2);
    });

    it("refuses a value nothing will fill in, and says which", async () => {
        const answer = await save({ en: "{count} of {total} orders" });
        expect(answer.status).toBe(400);
        expect(answer.body.code).toBe("translation_new_placeholder");
        expect(answer.body.details).toEqual({ locale: "en", names: ["total"] });
        expect(translation.upsert).not.toHaveBeenCalled();
    });

    it("refuses a brace that closes nothing, and says so by name", async () => {
        const answer = await save({ en: "{count orders" });
        expect(answer.status).toBe(400);
        expect(answer.body.code).toBe("translation_malformed");
    });

    it("writes nothing at all when one locale of the pair is refused", async () => {
        const answer = await save({ en: "{count} orders", tr: "{count} / {total}" });
        expect(answer.status).toBe(400);
        expect(answer.body.details?.locale).toBe("tr");
        expect(transaction).not.toHaveBeenCalled();
    });

    it("files the edit on the string's owner and undoes an older one on the theme's row", async () => {
        translation.findMany.mockResolvedValueOnce([
            { id: "r1", locale: "en", module: "core", namespace: "admin", key: "known", value: "{count} orders", isCustom: false },
            { id: "r2", locale: "en", module: "theme:kite", namespace: "admin", key: "known", value: "{count} kites", isCustom: true },
        ]);
        const answer = await save({ en: "{count} sales" });
        expect(answer.status).toBe(200);
        expect(translation.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ module: "core", value: "{count} sales", isCustom: true }),
        }));
        expect(translation.update).toHaveBeenCalledWith({ where: { id: "r2" }, data: { value: "{count} orders", isCustom: false } });
    });

    it("refuses a string the site does not have", async () => {
        translation.findMany.mockResolvedValueOnce([]);
        const answer = await save({ en: "{count} orders" }, "unknown");
        expect(answer.status).toBe(404);
        expect(answer.body.code).toBe("translation_not_found");
        expect(transaction).not.toHaveBeenCalled();
    });

    it("refuses a locale the site does not serve", async () => {
        const answer = await save({ ja: "{count} 件の注文" });
        expect(answer.status).toBe(400);
    });
});
