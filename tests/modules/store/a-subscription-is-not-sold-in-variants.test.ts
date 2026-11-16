// @vitest-environment node
/**
 * A subscription is not sold in variants.
 *
 * A subscription renews at the amount its first checkout charged, on the
 * product's own interval. Its variants could be priced and saved like any
 * other's, so a "12 months" variant on a monthly plan charged the year's
 * price every month, and its duration was never read. The product form
 * offers variants for every type, so the refusal is the server's, on both
 * ways a product is saved, and the checkout asks again for a row that got
 * its variants some other way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; type: string; variants: unknown };
let stored: Row = { id: "prod-1", type: "ONE_TIME", variants: null };
const written: unknown[] = [];

const db = {
    product: {
        // By id the stored row; by slug nothing, so a new product is new.
        findUnique: vi.fn(async (args: { where: { slug?: string } }) => (args.where.slug ? null : stored)),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async (args: { data: unknown }) => {
            written.push(args.data);
            return { ...stored, ...(args.data as object) };
        }),
        create: vi.fn(async (args: { data: unknown }) => {
            written.push(args.data);
            return { id: "prod-2", ...(args.data as object) };
        }),
    },
    orderItem: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};

vi.mock("@/core/sdk/server", async () => ({
    ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
    prisma: db,
    hasPermission: vi.fn(async () => true),
    moduleSettings: vi.fn(async () => ({})),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readJsonBody: async (request: Request) => request.json(),
    saveContentTranslations: vi.fn(async () => {}),
    pageParams: () => ({ page: 1, limit: 12, skip: 0, take: 12 }),
    textContains: (value: string) => ({ contains: value }),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/modules/store/lib/availability-input", () => ({ availabilityData: vi.fn(async () => ({})) }));

const { PATCH } = await import("@/modules/store/api/products/[id]/route");
const { POST } = await import("@/modules/store/api/products/route");
const { variantsRefusal } = await import("@/modules/store/lib/variants");

const packs = [
    { label: "1 month", price: 5 },
    { label: "12 months", price: 50, durationDays: 365 },
];

const send = (url: string, method: string, body: unknown) =>
    new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as never;

const patch = (body: unknown) =>
    PATCH(send("http://localhost/api/v1/store/products/prod-1", "PATCH", body), { params: Promise.resolve({ id: "prod-1" }) });

beforeEach(() => {
    stored = { id: "prod-1", type: "ONE_TIME", variants: null };
    written.length = 0;
});

describe("a subscription's variants", () => {
    it("are refused when a subscription is saved with them", async () => {
        stored = { id: "prod-1", type: "SUBSCRIPTION", variants: null };
        const res = await patch({ variants: packs });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("store_variant_subscription");
        expect(written).toHaveLength(0);
    });

    it("are refused when a product that has them becomes a subscription", async () => {
        stored = { id: "prod-1", type: "ONE_TIME", variants: [{ id: "a", label: "1 month", price: 5 }] };
        const res = await patch({ type: "SUBSCRIPTION" });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("store_variant_subscription");
    });

    it("are refused when a subscription is created with them", async () => {
        const res = await POST(send("http://localhost/api/v1/store/products", "POST", {
            name: "VIP",
            price: 5,
            type: "SUBSCRIPTION",
            subscriptionInterval: "month",
            subscriptionIntervalCount: 1,
            variants: packs,
        }));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("store_variant_subscription");
        expect(written).toHaveLength(0);
    });

    it("leave a subscription that sells as itself alone", async () => {
        stored = { id: "prod-1", type: "SUBSCRIPTION", variants: null };
        const res = await patch({ variants: [] });
        expect(res.status).toBe(200);
    });

    it("are the checkout's refusal too, for a row that holds them anyway", () => {
        expect(variantsRefusal("SUBSCRIPTION", [{ id: "a", label: "1 month", price: 5 }])).toBe("store_variant_subscription");
        expect(variantsRefusal("SUBSCRIPTION", [{ id: "a", label: "1 month", price: 5, isActive: false }])).toBeNull();
        expect(variantsRefusal("ONE_TIME", [{ id: "a", label: "1 month", price: 5 }])).toBeNull();
    });
});
