// @vitest-environment node
/**
 * The tax screen starts from what the shop already charged, and saves only
 * what the rules can use.
 *
 * Installing the module must not change a price. Until the operator saves the
 * screen the store's own rate stands, and the screen opens on that rate and
 * switch, so saving it unchanged keeps charging what the shop charged. What
 * is saved is read through the same reader the checkout uses, so a value the
 * rules would ignore is never stored as though it meant something.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const stored = { current: null as unknown };
const upsert = vi.fn(async () => ({}));
const permitted = { current: true };

vi.mock("@/core/sdk/server", () => ({
    moduleSettings: vi.fn(async () => ({ taxRate: 18, taxIncluded: true })),
    prisma: {
        setting: {
            findUnique: vi.fn(async () => (stored.current === null ? null : { value: stored.current })),
            upsert,
        },
    },
    hasPermission: vi.fn(async () => permitted.current),
    logActivity: vi.fn(async () => {}),
    readJsonBody: (request: Request) => request.json(),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin", role: "admin" } }) }));

const { GET, PUT } = await import("@/modules/tax/api/settings/route");

const valid = {
    pricesIncludeTax: false,
    defaultRate: 19,
    labelPreset: "vat",
    labelText: "",
    sellerCountry: "de",
    countryRates: { fr: 20, NL: 21 },
    outsideArea: "zero",
    reverseCharge: true,
    requireBillingAddress: true,
    trustCountryHeader: false,
    countryHeader: "CF-IPCountry",
};

const put = (body: unknown) =>
    PUT(new NextRequest("http://localhost/api/v1/tax/settings", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
    vi.clearAllMocks();
    stored.current = null;
    permitted.current = true;
});

describe("the tax screen", () => {
    it("opens on the store's own rate and switch before anything is saved", async () => {
        const body = await (await GET()).json();
        expect(body).toMatchObject({ defaultRate: 18, pricesIncludeTax: true, labelPreset: "tax", countryRates: {} });
    });

    it("opens on what was saved once something was", async () => {
        stored.current = { ...valid, sellerCountry: "DE" };
        expect(await (await GET()).json()).toMatchObject({ defaultRate: 19, sellerCountry: "DE", labelPreset: "vat" });
    });

    it("saves country codes in capitals and a header name in lowercase", async () => {
        const res = await put(valid);
        expect(res.status).toBe(200);
        const saved = (upsert.mock.calls[0] as unknown as [{ create: { value: Record<string, unknown>; module: string } }])[0].create;
        expect(saved.module).toBe("tax");
        expect(saved.value).toMatchObject({ sellerCountry: "DE", countryRates: { FR: 20, NL: 21 }, countryHeader: "cf-ipcountry" });
    });

    it("refuses a rate above a hundred, a country that is not a code and a label it does not know", async () => {
        expect((await put({ ...valid, defaultRate: 120 })).status).toBe(400);
        expect((await put({ ...valid, countryRates: { France: 20 } })).status).toBe(400);
        expect((await put({ ...valid, labelPreset: "kdv" })).status).toBe(400);
        expect(upsert).not.toHaveBeenCalled();
    });

    it("is closed to anybody without the tax permission", async () => {
        permitted.current = false;
        expect((await GET()).status).toBe(403);
        expect((await put(valid)).status).toBe(403);
    });
});
