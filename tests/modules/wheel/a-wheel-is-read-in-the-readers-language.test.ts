// @vitest-environment node
/**
 * A wheel's name and description, and each prize's label, written once per
 * language, are read in the reader's.
 *
 * The columns keep what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The wheel page asks
 * with `?locale=`, and a language with no translation reads the original. A
 * turn's log keeps the original name it was won under, as an order keeps its
 * item names.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const body: { value: unknown } = { value: {} };

const wheel = fakeTable(() => ({
    description: null, cooldown: "daily", cooldownHours: 24, cost: 0, roleIds: [], isActive: true, order: 0, createdAt: new Date(),
}));
const wheelPrize = fakeTable(() => ({ productId: null, value: 0, color: "#3b82f6", probability: 10, isActive: true, order: 0 }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);

// The page reads each wheel with its prizes on it, and the in-memory table
// knows no relations, so the prizes are joined here the way Prisma would.
const wheelRows = wheel.findMany.getMockImplementation()!;
type WheelRead = Parameters<typeof wheelRows>[0] & { include?: { prizes?: unknown } };
wheel.findMany.mockImplementation(async (args: WheelRead = {}) => {
    const rows = await wheelRows(args);
    if (!args.include?.prizes) return rows;
    return Promise.all(rows.map(async (row) => ({
        ...row,
        prizes: await wheelPrize.findMany({ where: { wheelId: row.id, isActive: true }, orderBy: { order: "asc" } }),
    })));
});
const db: Record<string, unknown> = { wheel, wheelPrize, contentTranslation };
db.$transaction = fakeTransaction(db, [wheel.table, wheelPrize.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => session.value !== null,
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

const wheels = () => import("@/modules/wheel/api/wheels/route");
const adminWheels = () => import("@/modules/wheel/api/admin/wheels/route");
const adminWheel = () => import("@/modules/wheel/api/admin/wheels/[id]/route");
const prizes = () => import("@/modules/wheel/api/prizes/route");
const prize = () => import("@/modules/wheel/api/prizes/[id]/route");

async function post<T>(handler: () => Promise<{ POST: (r: never) => Promise<Response> }>, payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await handler();
    const res = await POST(new Request("https://example.com", { method: "POST" }) as never);
    return { status: res.status, json: (await res.json()) as T };
}

/** What a visitor's wheel page is drawn from, wheels and the prizes on them. */
async function page(lang: string) {
    const visitor = session.value;
    session.value = null;
    const { GET } = await wheels();
    const res = await GET(new Request(`https://example.com/api/v1/wheel/wheels?locale=${lang}`) as never);
    session.value = visitor;
    return (await res.json()).wheels as { name: string; description: string | null; prizes: { name: string }[] }[];
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed() {
    const made = await post<{ wheel: { id: string } }>(adminWheels, {
        name: "Günlük çark", slug: "daily", cooldown: "daily", description: "Her gün bir tur",
        translations: { name: { en: "Daily wheel" }, description: { en: "One turn a day", de: "Eine Drehung am Tag" } },
    });
    expect(made.status).toBe(201);
    const won = await post<{ prize: { id: string } }>(prizes, {
        wheelId: made.json.wheel.id, name: "100 kredi", type: "credits", value: 100,
        translations: { name: { en: "100 credits" } },
    });
    expect(won.status).toBe(201);
    return { wheelId: made.json.wheel.id, prizeId: won.json.prize.id };
}

beforeEach(() => {
    wheel.table.rows = [];
    wheelPrize.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
});

describe("a wheel written in three languages", () => {
    it("is drawn for each visitor in their own, and in the original where theirs is missing", async () => {
        await seed();
        expect(await page("tr")).toMatchObject([{ name: "Günlük çark", description: "Her gün bir tur", prizes: [{ name: "100 kredi" }] }]);
        expect(await page("en")).toMatchObject([{ name: "Daily wheel", description: "One turn a day", prizes: [{ name: "100 credits" }] }]);
        expect(await page("de")).toMatchObject([{ name: "Günlük çark", description: "Eine Drehung am Tag", prizes: [{ name: "100 kredi" }] }]);
        expect(wheel.table.rows[0]).toMatchObject({ name: "Günlük çark" });
        expect(wheelPrize.table.rows[0]).toMatchObject({ name: "100 kredi" });
    });

    it("lists a prize to a visitor in their language", async () => {
        await seed();
        session.value = null;
        const { GET } = await prizes();
        const read = async (lang: string) =>
            (await (await GET(new Request(`https://example.com/api/v1/wheel/prizes?locale=${lang}`) as never)).json()).prizes;
        expect(await read("en")).toMatchObject([{ name: "100 credits" }]);
        expect(await read("fr")).toMatchObject([{ name: "100 kredi" }]);
    });

    it("is handed to the editors with every language", async () => {
        await seed();
        const listed = await (await (await adminWheels()).GET()).json();
        expect(listed.wheels).toEqual([expect.objectContaining({ translations: { name: { en: "Daily wheel" }, description: { en: "One turn a day", de: "Eine Drehung am Tag" } } })]);
        const { GET } = await prizes();
        const admin = await (await GET(new Request("https://example.com/api/v1/wheel/prizes") as never)).json();
        expect(admin.prizes).toEqual([expect.objectContaining({ translations: { name: { en: "100 credits" } } })]);
    });

    it("is edited language by language", async () => {
        const { wheelId, prizeId } = await seed();
        body.value = { name: "Çark", translations: { name: { de: "Rad" } } };
        expect((await (await adminWheel()).PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(wheelId))).status).toBe(200);
        body.value = { translations: { name: { en: "" } } };
        expect((await (await prize()).PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(prizeId))).status).toBe(200);
        expect(await page("en")).toMatchObject([{ name: "Çark", description: "One turn a day", prizes: [{ name: "100 kredi" }] }]);
        expect(await page("de")).toMatchObject([{ name: "Rad" }]);
    });

    it("takes its own and its prizes' translations with it when deleted", async () => {
        const { wheelId } = await seed();
        await (await adminWheel()).DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(wheelId));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("takes a prize's translations with it when the prize is deleted", async () => {
        const { prizeId } = await seed();
        await (await prize()).DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(prizeId));
        expect(contentTranslation.table.rows.map((row) => row.entity)).not.toContain("prize");
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await post(adminWheels, { name: "Çark", slug: "x", cooldown: "daily", translations: { name: { en: "x".repeat(81) } } });
        expect(status).toBe(400);
        expect(wheel.table.rows).toHaveLength(0);
    });
});
