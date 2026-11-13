// @vitest-environment node
/**
 * The reasons a rejection can give are the site's own list.
 *
 * Five ship as keyed rows whose wording comes from the catalogue until the
 * admin renames one; the admin adds, translates, orders and disables the
 * rest. A reason a decision already gave cannot be deleted, because the
 * Rejected view and the author's page still have to say what it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface ReasonRow {
    id: string;
    key: string | null;
    label: string | null;
    position: number;
    enabled: boolean;
}

let reasons: ReasonRow[] = [];
let translations: { owner: string; entity: string; recordId: string; field: string; locale: string; text: string }[] = [];
let decisionsUsing = new Set<string>();
let admin = true;

function matches(row: ReasonRow, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    if (where.enabled !== undefined && row.enabled !== where.enabled) return false;
    if (typeof where.id === "string" && row.id !== where.id) return false;
    return true;
}

vi.mock("@/core/lib/db", () => {
    const moderationReason = {
        findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
            reasons.filter((r) => matches(r, where)).sort((a, b) => a.position - b.position).map((r) => ({ ...r })),
        findUnique: async ({ where }: { where: { id: string } }) => reasons.find((r) => r.id === where.id) ?? null,
        create: async ({ data }: { data: Partial<ReasonRow> }) => {
            const row: ReasonRow = { id: `r${reasons.length + 1}`, key: null, label: null, position: 0, enabled: true, ...data };
            reasons.push(row);
            return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<ReasonRow> }) => {
            const row = reasons.find((r) => r.id === where.id);
            if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
            Object.assign(row, data);
            return row;
        },
        delete: async ({ where }: { where: { id: string } }) => {
            reasons = reasons.filter((r) => r.id !== where.id);
        },
        createMany: async ({ data }: { data: Partial<ReasonRow>[]; skipDuplicates?: boolean }) => {
            let count = 0;
            for (const row of data) {
                if (reasons.some((r) => r.key === row.key)) continue;
                reasons.push({ id: `reason_${row.key}`, key: null, label: null, position: 0, enabled: true, ...row });
                count++;
            }
            return { count };
        },
    };
    const contentTranslation = {
        findMany: async ({ where }: { where: { owner: string; entity: string; recordId: { in: string[] }; locale?: string; field?: { in: string[] } } }) =>
            translations.filter((t) =>
                t.owner === where.owner &&
                t.entity === where.entity &&
                where.recordId.in.includes(t.recordId) &&
                (where.locale === undefined || t.locale === where.locale) &&
                (where.field === undefined || where.field.in.includes(t.field)),
            ),
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
    };
    const moderationDecision = {
        count: async ({ where }: { where: { reasonId: string } }) => (decisionsUsing.has(where.reasonId) ? 1 : 0),
    };
    const prisma = {
        moderationReason,
        contentTranslation,
        moderationDecision,
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    return { prisma };
});

vi.mock("next-intl/server", () => ({
    getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
        (key: string) => `${locale}:${namespace ?? ""}.${key}`,
}));

vi.mock("@/core/lib/auth", () => ({
    auth: async () => ({ user: { id: "admin-1", role: admin ? "admin" : "member" } }),
}));
vi.mock("@/core/lib/permissions", () => ({
    isAdmin: async () => admin,
}));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/i18n/resolve-locale", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/lib/i18n/resolve-locale")>()),
    resolveLocaleFromRequest: async () => "tr",
}));

const { listReasons, reasonLabel } = await import("@/core/lib/moderation-reasons");
const reasonsRoute = await import("@/app/api/v1/admin/moderation/reasons/route");
const reasonRoute = await import("@/app/api/v1/admin/moderation/reasons/[id]/route");
const { NextRequest } = await import("next/server");

function jsonRequest(url: string, method: string, body?: unknown) {
    return new NextRequest(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

beforeEach(() => {
    admin = true;
    decisionsUsing = new Set();
    reasons = [
        { id: "reason_spam", key: "spam", label: null, position: 0, enabled: true },
        { id: "reason_abuse", key: "abuse", label: "Rudeness", position: 1, enabled: true },
        { id: "custom", key: null, label: "Cheating", position: 2, enabled: true },
        { id: "off", key: null, label: "Old rule", position: 3, enabled: false },
        // The other shipped three, switched off by this site.
        { id: "reason_advertising", key: "advertising", label: null, position: 10, enabled: false },
        { id: "reason_offTopic", key: "offTopic", label: null, position: 11, enabled: false },
        { id: "reason_other", key: "other", label: null, position: 12, enabled: false },
    ];
    translations = [
        { owner: "core", entity: "moderation-reason", recordId: "custom", field: "label", locale: "de", text: "Schummeln" },
    ];
});

describe("a reason's wording", () => {
    it("comes from the catalogue for a shipped reason nobody renamed", async () => {
        expect(await reasonLabel("reason_spam", "tr")).toBe("tr:admin.moderationReason_spam");
    });

    it("is the admin's own for a shipped reason they renamed", async () => {
        expect(await reasonLabel("reason_abuse", "tr")).toBe("Rudeness");
    });

    it("is the translation for the reader's language when there is one", async () => {
        expect(await reasonLabel("custom", "de")).toBe("Schummeln");
    });

    it("falls back to what the admin typed when the reader's language has none", async () => {
        expect(await reasonLabel("custom", "fr")).toBe("Cheating");
    });

    it("is still there for a reason that was disabled after it was used", async () => {
        expect(await reasonLabel("off", "en")).toBe("Old rule");
    });

    it("is null for a reason that does not exist", async () => {
        expect(await reasonLabel("gone", "en")).toBeNull();
    });
});

describe("the list a moderator chooses from", () => {
    it("holds only enabled reasons, in the admin's order", async () => {
        const list = await listReasons("de");
        expect(list.map((r) => r.id)).toEqual(["reason_spam", "reason_abuse", "custom"]);
        expect(list.map((r) => r.label)).toEqual(["de:admin.moderationReason_spam", "Rudeness", "Schummeln"]);
    });

    it("starts with the five shipped reasons on a site that has none", async () => {
        reasons = [];
        const list = await listReasons("en");
        expect(list.map((r) => r.id).sort()).toEqual(
            ["reason_abuse", "reason_advertising", "reason_offTopic", "reason_other", "reason_spam"],
        );
    });

    it("holds disabled ones too when the admin's screen asks", async () => {
        const list = await listReasons("en", { includeDisabled: true });
        expect(list.map((r) => r.id).slice(0, 4)).toEqual(["reason_spam", "reason_abuse", "custom", "off"]);
        expect(list).toHaveLength(7);
        expect(list[3].enabled).toBe(false);
    });
});

describe("the reasons endpoints", () => {
    it("refuse someone who is not an admin", async () => {
        admin = false;
        const res = await reasonsRoute.POST(jsonRequest("http://x/api/v1/admin/moderation/reasons", "POST", { label: "Bots" }));
        expect(res.status).toBe(403);
    });

    it("create a reason the admin named", async () => {
        const res = await reasonsRoute.POST(jsonRequest("http://x/api/v1/admin/moderation/reasons", "POST", { label: "Bots", position: 5 }));
        expect(res.status).toBe(201);
        expect(reasons.find((r) => r.label === "Bots")?.position).toBe(5);
    });

    it("refuse a reason with no name", async () => {
        const res = await reasonsRoute.POST(jsonRequest("http://x/api/v1/admin/moderation/reasons", "POST", { label: "  " }));
        expect(res.status).toBe(400);
    });

    it("let a shipped reason go back to the catalogue's wording", async () => {
        const res = await reasonRoute.PATCH(
            jsonRequest("http://x/api/v1/admin/moderation/reasons/reason_abuse", "PATCH", { label: "" }),
            { params: Promise.resolve({ id: "reason_abuse" }) },
        );
        expect(res.status).toBe(200);
        expect(await reasonLabel("reason_abuse", "tr")).toBe("tr:admin.moderationReason_abuse");
    });

    it("do not let a reason of the admin's own lose its name", async () => {
        const res = await reasonRoute.PATCH(
            jsonRequest("http://x/api/v1/admin/moderation/reasons/custom", "PATCH", { label: "" }),
            { params: Promise.resolve({ id: "custom" }) },
        );
        expect(res.status).toBe(400);
    });

    it("refuse to delete a reason a decision gave, and say so", async () => {
        decisionsUsing.add("custom");
        const res = await reasonRoute.DELETE(
            jsonRequest("http://x/api/v1/admin/moderation/reasons/custom", "DELETE"),
            { params: Promise.resolve({ id: "custom" }) },
        );
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("reason_in_use");
        expect(reasons.some((r) => r.id === "custom")).toBe(true);
    });

    it("refuse to delete a shipped reason, which can be disabled instead", async () => {
        const res = await reasonRoute.DELETE(
            jsonRequest("http://x/api/v1/admin/moderation/reasons/reason_spam", "DELETE"),
            { params: Promise.resolve({ id: "reason_spam" }) },
        );
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("reason_shipped");
    });

    it("delete a reason nothing used", async () => {
        const res = await reasonRoute.DELETE(
            jsonRequest("http://x/api/v1/admin/moderation/reasons/custom", "DELETE"),
            { params: Promise.resolve({ id: "custom" }) },
        );
        expect(res.status).toBe(200);
        expect(reasons.some((r) => r.id === "custom")).toBe(false);
    });

    it("list every reason with its wording in the admin's language", async () => {
        const res = await reasonsRoute.GET();
        const body = await res.json();
        expect(body.reasons.map((r: { id: string }) => r.id).slice(0, 4)).toEqual(["reason_spam", "reason_abuse", "custom", "off"]);
        expect(body.reasons[0].displayLabel).toBe("tr:admin.moderationReason_spam");
        expect(body.reasons[2].translations.label.de).toBe("Schummeln");
    });
});
