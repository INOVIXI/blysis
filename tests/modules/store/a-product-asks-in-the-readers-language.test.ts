// @vitest-environment node
/**
 * What a product asks the buyer is read in the buyer's language, and a
 * product is found by the name a shopper knows it by.
 *
 * A variable's label and placeholder keep the original in their columns;
 * its key (`name`) is what the checkout files the answer under, and is the
 * same in every language. A translation is a `ContentTranslation` row saved
 * in the same transaction. The site search matches a translation in any
 * language as well as the original columns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };

const tables = {
    product: fakeTable(() => ({ isActive: true, shortDesc: null, description: null, image: null, createdAt: new Date() })),
    productCommand: fakeTable(),
    productVariable: fakeTable(() => ({ type: "text", required: true, placeholder: null, options: null })),
    contentTranslation: fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]),
};
const db: Record<string, unknown> = {
    ...tables,
    $queryRaw: async () => { throw new Error("no full-text index here"); },
};
db.$transaction = fakeTransaction(db, Object.values(tables).map((t) => t.table));

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        hasPermission: async () => true,
        isModuleEnabled: async () => true,
        logActivity: async () => {},
        log: { error: () => {}, warn: () => {}, info: () => {} },
        readJsonBody: async () => body.value,
        searchMatches: () => "",
        searchRank: () => "",
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

const STORE = "../../../module-sources/store";
const request = (url = "https://example.com/x") => new Request(url) as never;

async function addVariable(payload: Record<string, unknown>) {
    body.value = { productId: "vip", name: "nick", type: "text", required: true, ...payload };
    const { POST } = await import(`${STORE}/api/product-variables/route`);
    const res = await POST(request());
    return { status: res.status, json: await res.json() };
}

async function readVariables(locale?: string) {
    const { GET } = await import(`${STORE}/api/product-variables/route`);
    const url = `https://example.com/api/v1/product-variables?productId=vip${locale ? `&locale=${locale}` : ""}`;
    const req = Object.assign(new Request(url), { nextUrl: new URL(url) });
    return (await (await GET(req as never)).json()).variables as Record<string, unknown>[];
}

beforeEach(() => {
    for (const t of Object.values(tables)) t.table.rows = [];
    body.value = {};
});

describe("a product's question to the buyer", () => {
    it("is asked in each buyer's language, and in the original where theirs is missing", async () => {
        const { status } = await addVariable({
            label: "Oyuncu adı", placeholder: "Oyundaki adın",
            translations: { label: { en: "Player name" }, placeholder: { en: "Your in-game name", de: "Dein Spielname" } },
        });
        expect(status).toBe(201);

        expect(await readVariables("tr")).toMatchObject([{ name: "nick", label: "Oyuncu adı", placeholder: "Oyundaki adın" }]);
        expect(await readVariables("en")).toMatchObject([{ name: "nick", label: "Player name", placeholder: "Your in-game name" }]);
        expect(await readVariables("de")).toMatchObject([{ name: "nick", label: "Oyuncu adı", placeholder: "Dein Spielname" }]);
        expect(await readVariables()).toMatchObject([{ label: "Oyuncu adı" }]);
        expect(tables.productVariable.table.rows[0]).toMatchObject({ name: "nick", label: "Oyuncu adı" });
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await addVariable({ label: "Oyuncu adı", translations: { label: { en: "x".repeat(201) } } });
        expect(status).toBe(400);
        expect(tables.productVariable.table.rows).toHaveLength(0);
        expect(tables.contentTranslation.table.rows).toHaveLength(0);
    });

    it("comes with a copy of its product, in every language", async () => {
        await tables.product.create({ data: {
            id: "vip", number: 1, slug: "vip", name: "VIP", price: 10, comparePrice: null, images: [], stock: null,
            availableFrom: null, availableUntil: null, availableDays: [], availableFromMinute: null, availableUntilMinute: null,
            outsideWindow: "countdown", roleIds: [], perPersonLimit: null, perPersonPeriod: "ever", periodStock: null,
            periodStockWindow: "day", salePrice: null, saleFrom: null, saleUntil: null, isFeatured: false, durationDays: null,
            categoryId: null, requiresProductIds: [], translations: null, deliveryData: null,
        } });
        await addVariable({ label: "Oyuncu adı", translations: { label: { en: "Player name" } } });
        body.value = {};
        const { POST } = await import(`${STORE}/api/admin/products/[id]/copy/route`);
        const res = await POST(request(), { params: Promise.resolve({ id: "vip" }) });
        expect(res.status).toBe(201);
        const copyId = (await res.json()).product.id;

        const copied = tables.productVariable.table.rows.find((row) => row.productId === copyId);
        expect(copied).toMatchObject({ name: "nick", label: "Oyuncu adı" });
        const { readContentTranslations } = await import("@/core/lib/content-translations");
        const words = await readContentTranslations(db as never, { owner: "store", entity: "variable" }, [String(copied?.id)]);
        expect(words.get(String(copied?.id))).toEqual({ label: { en: "Player name" } });
    });
});

describe("the site search", () => {
    it("finds a product by its name in another language, and still by its own", async () => {
        await tables.product.create({ data: { id: "vip", slug: "vip-rutbesi", name: "VIP Rütbesi" } });
        await tables.product.create({ data: { id: "off", slug: "kapali", name: "Kapalı", isActive: false } });
        await tables.contentTranslation.create({ data: { owner: "store", entity: "product", recordId: "vip", field: "name", locale: "en", text: "VIP Rank" } });
        await tables.contentTranslation.create({ data: { owner: "store", entity: "product", recordId: "off", field: "name", locale: "en", text: "Rank pack" } });
        const { default: search } = await import(`${STORE}/search/handler`);

        expect(await search("rank")).toMatchObject([{ title: "VIP Rütbesi", href: "/store/product/vip-rutbesi" }]);
        expect(await search("rütbe")).toMatchObject([{ title: "VIP Rütbesi" }]);
        expect(await search("nothing")).toEqual([]);
    });
});
