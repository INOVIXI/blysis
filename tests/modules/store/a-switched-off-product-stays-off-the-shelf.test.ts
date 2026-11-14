// @vitest-environment node
/**
 * A product an operator switched off is not on the shelf.
 *
 * The public listing filtered to active products unless the caller asked for
 * `?all=true`, and nothing checked who was asking. Anyone could name the
 * parameter and read every product the shop had ever turned off: the seasonal
 * ones, the mispriced ones, the ones pulled after a complaint.
 *
 * It matters more since the listing became something a proxy in front of the
 * site may hold for thirty seconds. An answer that changes with a query
 * parameter is a separate cache entry, so the leak would have been cached and
 * served rather than merely computed.
 *
 * The admin screen that needs the full list has its own endpoint now, behind
 * an administrator check. This one is public, and it answers the same thing
 * however it is asked.
 *
 * The listing was only half of it. `/api/v1/store/products/[id]` answers by
 * id, slug **or `number`**, and `number` is a sequential integer, so walking
 * 1, 2, 3 read every switched-off product the listing was careful to hide.
 * The shelf and the price tag have to agree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn(async () => []);
const count = vi.fn(async () => 0);
const findFirst = vi.fn<(args: unknown) => Promise<unknown>>(async () => null);

/** Flipped by the tests that ask what an administrator is allowed to see. */
let callerIsAdmin = false;

vi.mock("@/core/sdk/server", async () => ({
    ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
    prisma: {
        // No store-wide sale is running.
        storeSale: { findMany: async () => [] },
        product: {
            findMany: (args: unknown) => findMany(args as never),
            count: (args: unknown) => count(args as never),
            findFirst: (args: unknown) => findFirst(args),
        },
        // What the availability rules count: units already paid for, by this
        // person and by everybody. Nothing here sets a limit, so the answer is
        // always none.
        orderItem: { aggregate: async () => ({ _sum: { quantity: null } }) },
        // The shelf and the page both price through the running campaigns,
        // and none runs here.
        campaign: { findMany: async () => [] },
    },
    // The clock every schedule is read on. These rows carry no schedule, so
    // any zone gives the same answer.
    siteTimeZone: async () => "UTC",
    // What the shop calls "nearly gone". Zero switches the badge off, which
    // is the state these rows are testing around.
    moduleSettings: async () => ({ lowStockAt: 0 }),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    isAdmin: async () => callerIsAdmin,
    readJsonBody: async (request: Request) => request.json(),
    pageParams: () => ({ page: 1, limit: 12, skip: 0, take: 12 }),
    sanitizeHtml: (value: string) => value,
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: async () => (callerIsAdmin ? { user: { id: "admin1" } } : null),
}));

const productExists = (await import("@/modules/store/lib/route-exists")).default;
const { GET } = await import("@/modules/store/api/products/route");
const { GET: GET_ONE } = await import("@/modules/store/api/products/[id]/route");
const { NextRequest } = await import("next/server");

const SWITCHED_OFF = { id: "p9", slug: "withdrawn", number: 9, name: "Withdrawn", isActive: false };
const ON_SALE = { id: "p1", slug: "vip", number: 1, name: "VIP", isActive: true };

/**
 * Stands the row in the database up behind the query the route actually
 * writes. An earlier version of this file handed the row back whatever the
 * `where` said, which describes a database that does not exist - and would
 * have gone on passing if the filter were deleted.
 */
function rowInTheDatabase(row: { isActive: boolean } | null) {
    findFirst.mockImplementation(async (args) => {
        const where = (args as { where?: { isActive?: boolean } }).where ?? {};
        if (!row) return null;
        if (where.isActive === true && !row.isActive) return null;
        return row;
    });
}

/** The single-product route, asked for `id` by a caller who is or is not admin. */
async function readOne(id: string) {
    const response = await GET_ONE(
        new NextRequest(`http://example.com/api/v1/store/products/${id}`),
        { params: Promise.resolve({ id }) },
    );
    return { status: response.status, body: await response.json() };
}

/** The `where` the route asked the database for. */
function askedFor(): Record<string, unknown> {
    const args = findMany.mock.calls[0]?.[0] as unknown as { where: Record<string, unknown> };
    return args.where;
}

beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    findFirst.mockResolvedValue(null);
    callerIsAdmin = false;
});

describe("the public product listing", () => {
    it("asks only for products that are on sale", async () => {
        await GET(new NextRequest("http://example.com/api/v1/store/products"));
        expect(askedFor()).toMatchObject({ isActive: true });
    });

    it("still asks only for those when a caller asks for everything", async () => {
        await GET(new NextRequest("http://example.com/api/v1/store/products?all=true"));
        expect(askedFor()).toMatchObject({ isActive: true });
    });

    it("keeps filtering when a category is named as well", async () => {
        await GET(new NextRequest("http://example.com/api/v1/store/products?all=true&category=ranks"));
        expect(askedFor()).toMatchObject({ isActive: true });
    });
});

describe("the public product page", () => {
    it("does not hand a switched-off product to a visitor who guesses its number", async () => {
        rowInTheDatabase(SWITCHED_OFF);

        expect((await readOne("9")).status).toBe(404);
    });

    it("does not hand one over by slug either", async () => {
        rowInTheDatabase(SWITCHED_OFF);

        expect((await readOne("withdrawn")).status).toBe(404);
    });

    it("says the same thing it says for a product that never existed", async () => {
        rowInTheDatabase(SWITCHED_OFF);
        const hidden = await readOne("9");
        rowInTheDatabase(null);
        const absent = await readOne("does-not-exist");

        expect(hidden).toEqual(absent);
    });

    it("still answers for a product that is on sale", async () => {
        rowInTheDatabase(ON_SALE);

        const { status, body } = await readOne("vip");
        expect(status).toBe(200);
        expect(body.product.slug).toBe("vip");
    });

    // The admin edit screen used to load a product from this endpoint, which is
    // why it had an administrator exception. It has its own door now, so this
    // one answers the same thing to everybody - which is the property that lets
    // a proxy hold it.
    it("refuses a switched-off product even to an administrator", async () => {
        callerIsAdmin = true;
        rowInTheDatabase(SWITCHED_OFF);

        expect((await readOne("9")).status).toBe(404);
    });
});

describe("whether the product URL is a page at all", () => {
    // The router asks this before anything renders. Answering yes for a
    // switched-off product both walks a visitor into a page the API will
    // refuse, and answers the only question an enumerator was asking: which
    // of /store/product/1, /2, /3 name a real product.
    it("is no for a product an operator switched off", async () => {
        findFirst.mockResolvedValue(null);

        expect(await productExists({ params: ["product", "9"] })).toBe(false);
        expect(findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { isActive: true } });
    });

    it("is yes for one that is on sale", async () => {
        findFirst.mockResolvedValue({ id: "p1" });

        expect(await productExists({ params: ["product", "vip"] })).toBe(true);
    });

    it("is no when the URL names nothing at all", async () => {
        expect(await productExists({ params: [] })).toBe(false);
        expect(findFirst).not.toHaveBeenCalled();
    });
});
