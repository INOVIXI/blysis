// @vitest-environment node
/**
 * A release written up after it shipped keeps the day it shipped.
 *
 * The timeline is dated and ordered by `createdAt`, so a site that fills its
 * changelog in late used to show every release on the day it was typed. Create
 * and edit take the day now, bounded: never in the future, which is what
 * `publishAt` is for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const admin = { value: true };
const body: { value: unknown } = { value: {} };
let nextNumber = 1;

const changelogEntry = fakeTable(() => ({
    number: nextNumber++, isActive: true, publishAt: null, details: null, coverImage: null,
    type: "update", color: "#3b82f6", createdAt: new Date(),
}));
const changelogType = fakeTable(() => ({ isActive: true, order: 0 }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = {
    changelogEntry, changelogType, contentTranslation,
    activityFeedItem: { create: async () => ({}) },
};
db.$transaction = fakeTransaction(db, [changelogEntry.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        readJsonBody: async () => body.value,
        recordRevision: async () => {},
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {} }));

const list = () => import("../../../module-sources/changelog/api/route");
const one = () => import("../../../module-sources/changelog/api/[id]/route");
const page = () => import("../../../module-sources/changelog/api/entry/[number]/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(payload: Record<string, unknown>) {
    body.value = { version: "1.0", title: "Yeni harita", content: "x", ...payload };
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/changelog", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

async function edit(id: string, payload: Record<string, unknown>) {
    body.value = payload;
    const { PATCH } = await one();
    const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(id));
    return { status: res.status, json: await res.json() };
}

const SHIPPED = "2026-10-20T12:00:00.000Z";
const TOMORROW = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
    changelogEntry.table.rows = [];
    contentTranslation.table.rows = [];
    admin.value = true;
});

describe("a release written up after it shipped", () => {
    it("is dated the day it shipped", async () => {
        const { status, json } = await create({ createdAt: SHIPPED });
        expect(status).toBe(201);
        expect(new Date(json.entry.createdAt).toISOString()).toBe(SHIPPED);
    });

    it("is dated today when no day is given", async () => {
        const before = Date.now();
        const { json } = await create({ createdAt: null });
        expect(new Date(json.entry.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it("cannot have shipped in the future, and writes nothing", async () => {
        const { status } = await create({ createdAt: TOMORROW() });
        expect(status).toBe(400);
        expect(changelogEntry.table.rows).toHaveLength(0);
    });
});

describe("an edit", () => {
    it("can move a release to the day it shipped", async () => {
        const { json } = await create({});
        const { status, json: edited } = await edit(json.entry.id, { createdAt: SHIPPED });
        expect(status).toBe(200);
        expect(new Date(edited.entry.createdAt).toISOString()).toBe(SHIPPED);
    });

    it("keeps the day when the date field is left empty", async () => {
        const { json } = await create({ createdAt: SHIPPED });
        const { json: edited } = await edit(json.entry.id, { title: "Yeni çöl", createdAt: null });
        expect(new Date(edited.entry.createdAt).toISOString()).toBe(SHIPPED);
    });

    it("cannot move a release into the future", async () => {
        const { json } = await create({ createdAt: SHIPPED });
        const { status } = await edit(json.entry.id, { createdAt: TOMORROW() });
        expect(status).toBe(400);
        expect(new Date(changelogEntry.table.rows[0].createdAt as Date).toISOString()).toBe(SHIPPED);
    });
});
