// @vitest-environment node
/**
 * What an operator writes about the shop is read in the shopper's language.
 *
 * A product's name, summary and description, a shelf's name and description,
 * a credit package's and a campaign's name keep the original in their
 * columns, where search, sorting and exports read them; a translation is a
 * `ContentTranslation` row, saved in the same transaction as the record. The
 * shelf, the product page, the listings and the package list read them in
 * the shopper's language, and in the original where theirs has none. The
 * community goal's title is a setting and holds phase one's shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };

const SHELF = { id: "c-ranks", name: "Rütbeler", slug: "ranks" };

function product(over: Record<string, unknown>): Record<string, unknown> {
    return {
        number: 1, slug: String(over.id), description: null, shortDesc: null,
        price: 10, comparePrice: null, image: null, images: [], stock: null, isActive: true,
        availableFrom: null, availableUntil: null, availableDays: [], availableFromMinute: null, availableUntilMinute: null,
        outsideWindow: "countdown", roleIds: [], perPersonLimit: null, perPersonPeriod: "ever",
        periodStock: null, periodStockWindow: "day", salePrice: null, saleFrom: null, saleUntil: null,
        isFeatured: false, durationDays: null, createdAt: new Date(), categoryId: SHELF.id, category: SHELF,
        ...over,
    };
}

const tables = {
    product: fakeTable(),
    category: fakeTable(() => ({ isActive: true, order: 0, layout: "grid", parentId: null, image: null, description: null, children: [] })),
    creditPackage: fakeTable(() => ({ isActive: true, order: 0, bonusCredits: 0, availableFrom: null, availableUntil: null })),
    campaign: fakeTable(() => ({ isActive: true, days: [], createdAt: new Date(), entries: [] })),
    campaignEntry: fakeTable(),
    storeSale: fakeTable(),
    ownedProduct: fakeTable(),
    productCommand: fakeTable(),
    productVariable: fakeTable(),
    setting: fakeTable(),
    // The goal adds each currency apart and converts it (#124); nothing was paid here.
    order: { aggregate: async () => ({ _sum: { total: 0 } }), groupBy: async () => [] },
    contentTranslation: fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]),
};
const db: Record<string, unknown> = { ...tables };
db.$transaction = fakeTransaction(db, Object.values(tables).flatMap((t) => ("table" in t ? [t.table] : [])));

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        hasPermission: async () => true,
        isAdmin: async () => true,
        logActivity: async () => {},
        log: { error: () => {}, warn: () => {}, info: () => {} },
        readJsonBody: async () => body.value,
        moduleSettings: async () => ({ lowStockAt: 0, enableUpgradeCredit: false }),
        siteTimeZone: async () => "UTC",
        siteCurrency: async () => "USD",
        textContains: () => [],
        pageParams: () => ({ page: 1, limit: 12, skip: 0, take: 12 }),
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

const STORE = "../../../module-sources/store";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (url = "https://example.com/x") => new Request(url) as never;

async function seed(owner: string, entity: string, recordId: string, field: string, locale: string, text: string) {
    await tables.contentTranslation.create({ data: { owner, entity, recordId, field, locale, text } });
}

beforeEach(() => {
    for (const t of Object.values(tables)) if ("table" in t) t.table.rows = [];
    body.value = {};
});

describe("the shelf a shopper reads", () => {
    beforeEach(async () => {
        // Newest first is the shelf's order, so VIP is the newer.
        await tables.product.create({ data: product({ id: "vip", name: "VIP Rütbesi", shortDesc: "Sohbette renk", createdAt: new Date(2026, 10, 2) }) });
        await tables.product.create({ data: product({ id: "mvp", name: "MVP Rütbesi", createdAt: new Date(2026, 10, 1) }) });
        await seed("store", "product", "vip", "name", "en", "VIP Rank");
        await seed("store", "product", "vip", "shortDesc", "en", "Colour in chat");
        await seed("store", "product", "vip", "description", "en", "Not on a shelf card");
        await seed("store", "product", "mvp", "name", "de", "MVP-Rang");
        await seed("store", "category", SHELF.id, "name", "en", "Ranks");
    });

    it("names the products and their shelf in the shopper's language, and the original where theirs has none", async () => {
        const { readStoreProducts } = await import(`${STORE}/lib/read-store`);
        const read = async (locale: string) =>
            ((await readStoreProducts({ sort: "newest", page: 1, locale })).products as Record<string, unknown>[])
                .map((p) => [p.name, p.shortDesc, (p.category as { name: string }).name]);

        expect(await read("tr")).toEqual([["VIP Rütbesi", "Sohbette renk", "Rütbeler"], ["MVP Rütbesi", null, "Rütbeler"]]);
        expect(await read("en")).toEqual([["VIP Rank", "Colour in chat", "Ranks"], ["MVP Rütbesi", null, "Ranks"]]);
        expect(await read("de")).toEqual([["VIP Rütbesi", "Sohbette renk", "Rütbeler"], ["MVP-Rang", null, "Rütbeler"]]);
    });

    it("reads a whole page of translations at once, not a product at a time", async () => {
        const { readStoreProducts } = await import(`${STORE}/lib/read-store`);
        tables.contentTranslation.findMany.mockClear();
        await readStoreProducts({ sort: "newest", page: 1, locale: "en" });
        // One for the products, one for the shelves they sit on.
        expect(tables.contentTranslation.findMany).toHaveBeenCalledTimes(2);
    });

    it("gives the shopping listing the same words", async () => {
        const { GET } = await import(`${STORE}/api/products/route`);
        const { NextRequest } = await import("next/server");
        const res = await GET(new NextRequest("https://example.com/api/v1/store/products?locale=en"));
        const names = (await res.json()).products.map((p: { name: string }) => p.name);
        expect(names).toEqual(["VIP Rank", "MVP Rütbesi"]);
    });
});

describe("a shelf the operator names in three languages", () => {
    it("is written with its languages, read in each, and leaves with them", async () => {
        body.value = {
            name: "Rütbeler", slug: "ranks", description: "Sunucudaki rütbeler",
            translations: { name: { en: "Ranks", de: "Ränge" }, description: { en: "Ranks on the server" } },
        };
        const list = await import(`${STORE}/api/categories/route`);
        const created = await list.POST(request());
        expect(created.status).toBe(201);
        const id = (await created.json()).category.id;
        expect(tables.category.table.rows[0]).toMatchObject({ name: "Rütbeler", description: "Sunucudaki rütbeler" });

        const read = async (locale: string) =>
            (await (await list.GET(request(`https://example.com/api/v1/store/categories?locale=${locale}`))).json()).categories[0];
        expect(await read("tr")).toMatchObject({ name: "Rütbeler", description: "Sunucudaki rütbeler" });
        expect(await read("en")).toMatchObject({ name: "Ranks", description: "Ranks on the server" });
        expect(await read("de")).toMatchObject({ name: "Ränge", description: "Sunucudaki rütbeler" });

        const { readStoreCategories } = await import(`${STORE}/lib/read-store`);
        expect((await readStoreCategories("en"))[0]).toMatchObject({ name: "Ranks" });

        const admin = (await (await list.GET(request("https://example.com/api/v1/store/categories?scope=admin"))).json()).categories[0];
        expect(admin.translations).toEqual({ name: { en: "Ranks", de: "Ränge" }, description: { en: "Ranks on the server" } });

        body.value = { name: "Rütbe", translations: { name: { en: "Rank" } } };
        const one = await import(`${STORE}/api/categories/[id]/route`);
        expect((await one.PATCH(request(), params(id))).status).toBe(200);
        expect(await read("en")).toMatchObject({ name: "Rank", description: "Ranks on the server" });
        expect(await read("de")).toMatchObject({ name: "Rütbe" });

        await one.DELETE(request(), params(id));
        expect(tables.contentTranslation.table.rows).toHaveLength(0);
    });
});

describe("a product the operator edits in three languages", () => {
    it("is saved with its languages, opened in the editor with them, and read in each", async () => {
        await tables.product.create({ data: product({ id: "vip", name: "VIP Rütbesi", description: "Uzun metin" }) });
        body.value = {
            name: "VIP Rütbesi",
            translations: { name: { en: "VIP Rank" }, description: { en: "Long text", de: "Langer Text" }, shortDesc: {} },
        };
        const { PATCH } = await import(`${STORE}/api/products/[id]/route`);
        expect((await PATCH(request(), params("vip"))).status).toBe(200);

        const { GET: ADMIN } = await import(`${STORE}/api/admin/products/[id]/route`);
        const edited = (await (await ADMIN(request(), params("vip"))).json()).product;
        expect(edited.translations).toEqual({ name: { en: "VIP Rank" }, description: { en: "Long text", de: "Langer Text" } });

        const { readProduct } = await import(`${STORE}/lib/read-product`);
        expect(await readProduct("vip", "en")).toMatchObject({ name: "VIP Rank", description: "Long text", category: { name: "Rütbeler" } });
        expect(await readProduct("vip", "de")).toMatchObject({ name: "VIP Rütbesi", description: "Langer Text" });
        expect(await readProduct("vip", "tr")).toMatchObject({ name: "VIP Rütbesi", description: "Uzun metin" });
    });

    it("refuses a translation longer than its column", async () => {
        await tables.product.create({ data: product({ id: "vip", name: "VIP" }) });
        body.value = { translations: { shortDesc: { en: "x".repeat(501) } } };
        const { PATCH } = await import(`${STORE}/api/products/[id]/route`);
        expect((await PATCH(request(), params("vip"))).status).toBe(400);
        expect(tables.contentTranslation.table.rows).toHaveLength(0);
    });
});

describe("a copy of a product", () => {
    async function copy(payload: Record<string, unknown>) {
        await tables.product.create({ data: product({ id: "vip", name: "VIP Rütbesi", description: "Metin", translations: null, deliveryData: null, requiresProductIds: [] }) });
        await seed("store", "product", "vip", "name", "en", "VIP Rank");
        await seed("store", "product", "vip", "description", "en", "Text");
        body.value = payload;
        const { POST } = await import(`${STORE}/api/admin/products/[id]/copy/route`);
        const res = await POST(request(), params("vip"));
        expect(res.status).toBe(201);
        const { readContentTranslations } = await import("@/core/lib/content-translations");
        const id = (await res.json()).product.id;
        return (await readContentTranslations(db as never, { owner: "store", entity: "product" }, [id])).get(id);
    }

    it("says what the original says in every language", async () => {
        expect(await copy({})).toEqual({ name: { en: "VIP Rank" }, description: { en: "Text" } });
    });

    it("keeps the description's languages but not the old name's when it is given a name of its own", async () => {
        expect(await copy({ name: "VIP Rütbesi (kopya)" })).toEqual({ description: { en: "Text" } });
    });
});

describe("a credit package and a campaign", () => {
    it("sells a package under its name in the buyer's language", async () => {
        body.value = { name: "Küçük paket", credits: 100, price: 5, translations: { name: { en: "Small pack" } } };
        const admin = await import(`${STORE}/api/admin/credit-packages/route`);
        expect((await admin.POST(request())).status).toBe(201);

        const { GET } = await import(`${STORE}/api/credit-packages/route`);
        const read = async (locale: string) =>
            (await (await GET(request(`https://example.com/api/v1/store/credit-packages?locale=${locale}`))).json()).packages[0].name;
        expect(await read("en")).toBe("Small pack");
        expect(await read("tr")).toBe("Küçük paket");
        expect(await read("de")).toBe("Küçük paket");

        const listed = (await (await admin.GET()).json()).packages[0];
        expect(listed.translations).toEqual({ name: { en: "Small pack" } });
    });

    it("keeps a campaign's name in every language for the operator, and drops them with it", async () => {
        body.value = { name: "Yaz indirimi", translations: { name: { en: "Summer sale" } } };
        const list = await import(`${STORE}/api/campaigns/route`);
        const created = await list.POST(request());
        expect(created.status).toBe(201);
        const id = (await created.json()).campaign.id;
        expect((await (await list.GET()).json()).campaigns[0].translations).toEqual({ name: { en: "Summer sale" } });

        body.value = { translations: { name: { en: "Summer deals", de: "Sommerangebote" } } };
        const one = await import(`${STORE}/api/campaigns/[id]/route`);
        expect((await one.PATCH(request(), params(id))).status).toBe(200);
        expect((await (await list.GET()).json()).campaigns[0].translations).toEqual({ name: { en: "Summer deals", de: "Sommerangebote" } });

        await one.DELETE(request(), params(id));
        expect(tables.contentTranslation.table.rows).toHaveLength(0);
    });
});

describe("the community goal", () => {
    it("is titled in the reader's language, and in the original where theirs has none", async () => {
        body.value = { target: 1000, title: { default: "Aylık hedef", en: "Monthly goal" } };
        const route = await import(`${STORE}/api/community-goal/route`);
        expect((await route.PATCH(request())).status).toBe(200);

        const read = async (locale: string) =>
            (await (await route.GET(request(`https://example.com/api/v1/community-goal?locale=${locale}`))).json()).title;
        expect(await read("en")).toBe("Monthly goal");
        expect(await read("tr")).toBe("Aylık hedef");
        expect(await read("de")).toBe("Aylık hedef");
    });
});
