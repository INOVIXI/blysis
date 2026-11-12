// @vitest-environment node
/**
 * A form can be an application: sent by a signed-in member, a set number of
 * times a period, and answered with a decision the member can read.
 *
 * Each of those is a rule the endpoints keep, not one the page draws. A
 * sign-in prompt in place of the form is no use if the submit endpoint still
 * takes an anonymous post, and an allowance the page hides is one a second
 * tab spends twice. So these run the handlers against an in-memory database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

let session: { user: { id: string; role?: string } } | null = null;
let admins = new Set<string>();

const forms = fakeTable(() => ({
    description: null,
    isActive: true,
    requireSignIn: false,
    submissionLimit: null,
    limitPeriodStart: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
}));
const submissions = fakeTable(() => ({ status: "new", reviewNote: null, reviewedAt: null, createdAt: new Date() }));
// The fake reads columns only; a submission's `form` is a relation, joined
// here the way Prisma would for a `select` that names it.
const listSubmissions = submissions.findMany;
submissions.findMany = vi.fn(async (args: Parameters<typeof listSubmissions>[0] = {}) => {
    const rows = await listSubmissions(args);
    const relation = (args.select as Record<string, unknown> | undefined)?.form as { select: Record<string, boolean> } | undefined;
    if (!relation) return rows;
    return rows.map((row, index) => {
        const source = submissions.table.rows.filter((r) => r.id === row.id)[0] ?? rows[index];
        const form = forms.table.rows.find((f) => f.id === source.formId) ?? {};
        return { ...row, form: Object.fromEntries(Object.keys(relation.select).map((key) => [key, form[key]])) };
    });
});
const users = fakeTable();
const executeRaw = vi.fn(async () => 0);
const doActionAsync = vi.fn(async () => {});
const logActivity = vi.fn(async () => {});

const prisma = {
    customForm: forms,
    customFormSubmission: submissions,
    user: users,
    activityFeedItem: { create: vi.fn(async () => ({})) },
    $executeRaw: executeRaw,
    $transaction: undefined as unknown,
};
prisma.$transaction = fakeTransaction(prisma, [forms.table, submissions.table]);

vi.mock("@/core/sdk/server", async () => ({
    prisma,
    // No translations are seeded here: each record reads as written.
    translateContent: async (_db: unknown, _kind: unknown, rows: unknown[]) => rows,
    attachContentTranslations: async (_db: unknown, _kind: unknown, rows: object[]) => rows.map((row) => ({ ...row, translations: {} })),
    saveContentTranslations: async () => undefined,
    contentTranslationsInput: (await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")).contentTranslationsInput,
    isAdmin: async (id: string) => admins.has(id),
    readJsonBody: async (request: Request) => request.json(),
    rateLimitForRoleAsync: async () => true,
    getClientIP: () => "127.0.0.1",
    runChallenge: async () => ({ ok: true }),
    challengeFieldsFrom: () => ({}),
    logActivity,
    pageParams: () => ({ page: 1, limit: 50, skip: 0, take: 50 }),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session }));
vi.mock("@/core/sdk", () => ({ doActionAsync, generateSlug: (title: string) => title.toLowerCase().replace(/\s+/g, "-") }));

const formRoute = await import("@/modules/custom-forms/api/[slug]/route");
const formsRoute = await import("@/modules/custom-forms/api/route");
const submissionRoute = await import("@/modules/custom-forms/api/submissions/[id]/route");
const mineRoute = await import("@/modules/custom-forms/api/submissions/mine/route");
const allowancesRoute = await import("@/modules/custom-forms/api/[slug]/allowances/route");

const FIELDS = [{ name: "why", type: "textarea", label: "Why", required: true }];

function request(url: string, method = "GET", body?: unknown): NextRequest {
    return new NextRequest(`http://localhost${url}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
}

const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function apply(slug = "staff") {
    return formRoute.POST(request(`/api/v1/forms/${slug}`, "POST", { data: { why: "I like it here" } }), slugParams(slug));
}

beforeEach(() => {
    vi.clearAllMocks();
    forms.table.rows = [];
    submissions.table.rows = [];
    users.table.rows = [{ id: "admin", username: "Admin" }, { id: "m1", username: "Member" }];
    session = null;
    admins = new Set(["admin"]);
    forms.table.rows.push({
        id: "f1", title: "Staff application", slug: "staff", fields: FIELDS, isActive: true,
        description: null, requireSignIn: true, submissionLimit: 1, limitPeriodStart: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
    });
});

describe("a form that asks visitors to sign in", () => {
    it("refuses an anonymous submission with a code the page can name", async () => {
        const res = await apply();
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: "sign_in_required" });
        expect(submissions.table.rows).toHaveLength(0);
    });

    it("takes a member's", async () => {
        session = { user: { id: "m1" } };
        expect((await apply()).status).toBe(201);
        expect(submissions.table.rows[0]).toMatchObject({ formId: "f1", userId: "m1" });
    });

    it("leaves a form that does not ask open to anyone, as it was", async () => {
        forms.table.rows[0].requireSignIn = false;
        forms.table.rows[0].submissionLimit = null;
        expect((await apply()).status).toBe(201);
    });
});

describe("a member's allowance", () => {
    it("is spent by a submission and then refused with a clear code", async () => {
        session = { user: { id: "m1" } };
        expect((await apply()).status).toBe(201);
        const second = await apply();
        expect(second.status).toBe(409);
        expect(await second.json()).toMatchObject({ code: "limit_reached" });
        expect(submissions.table.rows).toHaveLength(1);
    });

    it("is checked under a lock, so two tabs cannot both spend the last one", async () => {
        session = { user: { id: "m1" } };
        await apply();
        expect(executeRaw).toHaveBeenCalled();
    });

    it("is one member's, not the form's", async () => {
        submissions.table.rows.push({ id: "s0", formId: "f1", userId: "other", data: {}, status: "new", createdAt: new Date() });
        session = { user: { id: "m1" } };
        expect((await apply()).status).toBe(201);
    });

    it("comes back after a reset, and the old submission stays with its decision", async () => {
        submissions.table.rows.push({
            id: "old", formId: "f1", userId: "m1", data: { why: "first" }, status: "rejected",
            reviewNote: "Not this time", createdAt: new Date("2026-02-01T00:00:00Z"),
        });
        session = { user: { id: "m1" } };
        expect((await apply()).status).toBe(409);

        session = { user: { id: "admin" } };
        const reset = await allowancesRoute.POST(request("/api/v1/forms/staff/allowances", "POST"), slugParams("staff"));
        expect(reset.status).toBe(200);
        expect(forms.table.rows[0].limitPeriodStart).toBeInstanceOf(Date);
        expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "custom_form.allowances_reset", entityId: "f1" }));

        session = { user: { id: "m1" } };
        expect((await apply()).status).toBe(201);
        expect(submissions.table.rows.find((row) => row.id === "old")).toMatchObject({ status: "rejected", reviewNote: "Not this time" });
    });

    it("can only be reset by an administrator", async () => {
        session = { user: { id: "m1" } };
        const res = await allowancesRoute.POST(request("/api/v1/forms/staff/allowances", "POST"), slugParams("staff"));
        expect(res.status).toBe(403);
        expect(forms.table.rows[0].limitPeriodStart).toBeNull();
    });

    it("tells the panel when the period started and how many members applied in it", async () => {
        forms.table.rows[0].limitPeriodStart = new Date("2026-03-01T00:00:00Z");
        submissions.table.rows.push(
            { id: "a", formId: "f1", userId: "m1", data: {}, status: "new", createdAt: new Date("2026-02-01T00:00:00Z") },
            { id: "b", formId: "f1", userId: "m2", data: {}, status: "new", createdAt: new Date("2026-03-02T00:00:00Z") },
            { id: "c", formId: "f1", userId: "m3", data: {}, status: "new", createdAt: new Date("2026-03-03T00:00:00Z") },
        );
        session = { user: { id: "admin" } };
        const res = await allowancesRoute.GET(request("/api/v1/forms/staff/allowances"), slugParams("staff"));
        expect(await res.json()).toMatchObject({ periodStart: "2026-03-01T00:00:00.000Z", members: 2 });
    });
});

describe("a limit on a form", () => {
    it("is refused on a form that anyone may send", async () => {
        session = { user: { id: "admin" } };
        const res = await formsRoute.POST(request("/api/v1/forms", "POST", {
            title: "Open", fields: FIELDS, requireSignIn: false, submissionLimit: 2,
        }));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "limit_needs_sign_in" });
    });

    it("is refused when sign-in is switched off under it", async () => {
        session = { user: { id: "admin" } };
        const res = await formRoute.PATCH(request("/api/v1/forms/staff", "PATCH", { requireSignIn: false }), slugParams("staff"));
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "limit_needs_sign_in" });
        expect(forms.table.rows[0].requireSignIn).toBe(true);
    });

    it("is kept when the form is saved with both", async () => {
        session = { user: { id: "admin" } };
        const res = await formRoute.PATCH(request("/api/v1/forms/staff", "PATCH", { requireSignIn: true, submissionLimit: 3 }), slugParams("staff"));
        expect(res.status).toBe(200);
        expect(forms.table.rows[0].submissionLimit).toBe(3);
    });
});

describe("a decision on a submission", () => {
    beforeEach(() => {
        submissions.table.rows.push({ id: "s1", formId: "f1", userId: "m1", data: { why: "x" }, status: "read", reviewNote: null, createdAt: new Date() });
    });

    it("is approved or rejected with a note to the applicant, and the hook says so", async () => {
        session = { user: { id: "admin" } };
        const res = await submissionRoute.PATCH(
            request("/api/v1/forms/submissions/s1", "PATCH", { status: "approved", reviewNote: "Welcome aboard" }),
            idParams("s1"),
        );
        expect(res.status).toBe(200);
        expect(submissions.table.rows[0]).toMatchObject({ status: "approved", reviewNote: "Welcome aboard" });
        expect(doActionAsync).toHaveBeenCalledWith("customforms.submission.reviewed", {
            formId: "f1", submissionId: "s1", userId: "m1", status: "approved", previousStatus: "read",
        });
    });

    it("can be a note alone, which is not a change of state", async () => {
        session = { user: { id: "admin" } };
        const res = await submissionRoute.PATCH(
            request("/api/v1/forms/submissions/s1", "PATCH", { reviewNote: "We will read it this week" }),
            idParams("s1"),
        );
        expect(res.status).toBe(200);
        expect(submissions.table.rows[0]).toMatchObject({ status: "read", reviewNote: "We will read it this week" });
        expect(doActionAsync).not.toHaveBeenCalled();
    });

    it("keeps the three working states", async () => {
        session = { user: { id: "admin" } };
        const res = await submissionRoute.PATCH(request("/api/v1/forms/submissions/s1", "PATCH", { status: "handled" }), idParams("s1"));
        expect(res.status).toBe(200);
        expect(submissions.table.rows[0].status).toBe("handled");
    });

    it("is an administrator's to make", async () => {
        session = { user: { id: "m1" } };
        const res = await submissionRoute.PATCH(request("/api/v1/forms/submissions/s1", "PATCH", { status: "approved" }), idParams("s1"));
        expect(res.status).toBe(403);
        expect(submissions.table.rows[0].status).toBe("read");
    });
});

describe("a member's own submissions", () => {
    beforeEach(() => {
        submissions.table.rows.push(
            { id: "s1", formId: "f1", userId: "m1", data: { why: "x" }, status: "read", reviewNote: null, createdAt: new Date("2026-03-01T00:00:00Z") },
            { id: "s2", formId: "f1", userId: "m1", data: { why: "y" }, status: "approved", reviewNote: "Welcome", createdAt: new Date("2026-03-02T00:00:00Z") },
            { id: "s3", formId: "f1", userId: "someone", data: { why: "z" }, status: "new", createdAt: new Date("2026-03-03T00:00:00Z") },
        );
    });

    it("are listed for the member alone, with the status they can read and the note to them", async () => {
        session = { user: { id: "m1" } };
        const res = await mineRoute.GET(request("/api/v1/forms/submissions/mine"));
        const body = await res.json();
        expect(body.submissions.map((row: { id: string }) => row.id)).toEqual(["s2", "s1"]);
        expect(body.submissions[0]).toMatchObject({ status: "approved", reviewNote: "Welcome", form: { title: "Staff application", slug: "staff" } });
        expect(body.submissions[1]).toMatchObject({ status: "pending" });
        expect(body.submissions[0]).not.toHaveProperty("data");
    });

    it("are nobody's business without a session", async () => {
        const res = await mineRoute.GET(request("/api/v1/forms/submissions/mine"));
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: "sign_in_required" });
    });

    it("are on the form's own page with what is left of the allowance", async () => {
        session = { user: { id: "m1" } };
        forms.table.rows[0].submissionLimit = 2;
        const res = await formRoute.GET(request("/api/v1/forms/staff"), slugParams("staff"));
        const body = await res.json();
        expect(body.viewer).toMatchObject({ signedIn: true, used: 2, limit: 2 });
        expect(body.viewer.submissions[0]).toMatchObject({ id: "s2", status: "approved", reviewNote: "Welcome" });
    });

    it("are not offered to a visitor, who is told to sign in", async () => {
        const res = await formRoute.GET(request("/api/v1/forms/staff"), slugParams("staff"));
        const body = await res.json();
        expect(body.viewer).toEqual({ signedIn: false });
    });
});
