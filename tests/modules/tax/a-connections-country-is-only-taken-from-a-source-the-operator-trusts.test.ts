// @vitest-environment node
/**
 * A connection's country is only taken from a source the operator trusts.
 *
 * The second piece of location evidence is where the buyer's connection comes
 * from. A CDN such as Cloudflare says so in a header, and a header is
 * something anybody can send: on a site that is not behind that CDN, trusting
 * `CF-IPCountry` lets a buyer pick their own rate. So the header is read only
 * once the operator says the site is behind one. Otherwise the country comes
 * from whatever answers `geo.country`, which nothing does by default - a
 * lookup is a database or a paid service, and installing one is the
 * operator's choice. The address itself is kept only cut to its network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const stored = { current: null as unknown };
const lookups: { ip: string }[] = [];
const lookupAnswer = { current: null as string | null };

vi.mock("@/core/sdk/server", () => ({
    moduleSettings: vi.fn(async () => ({ taxRate: 18, taxIncluded: true })),
    prisma: {
        setting: { findUnique: vi.fn(async () => (stored.current === null ? null : { value: stored.current })) },
    },
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, context: { ip: string }) => {
        if (hook !== "geo.country") return value;
        lookups.push(context);
        return lookupAnswer.current ?? value;
    }),
}));

const { default: onStoreTax } = await import("@/modules/tax/hooks/on-store-tax");
const { default: onBillingRequired } = await import("@/modules/tax/hooks/on-billing-required");

const STORE_ANSWER: StoreTaxAnswer = {
    rate: 18,
    included: false,
    label: { kind: "preset", id: "tax" },
    country: null,
    reason: "standard",
    evidence: null,
};

function sale(change: Partial<StoreTaxContext> = {}, headers: Record<string, string> = {}): StoreTaxContext {
    return {
        channel: "checkout",
        currency: "EUR",
        billing: null,
        ip: "198.51.100.23",
        header: (name) => headers[name] ?? null,
        ...change,
    };
}

const EU = { sellerCountry: "DE", defaultRate: 19, countryRates: { DE: 19, FR: 20, NL: 21 }, labelPreset: "vat" };

beforeEach(() => {
    stored.current = EU;
    lookups.length = 0;
    lookupAnswer.current = null;
});

describe("the connection's country", () => {
    it("is not read from a CDN header the operator has not said to trust", async () => {
        const answer = await onStoreTax(STORE_ANSWER, sale({}, { "cf-ipcountry": "FR" }));
        expect(answer.evidence?.ipCountry).toBeNull();
        expect(answer).toMatchObject({ rate: 19, reason: "standard" });
    });

    it("is read from the header once the operator trusts it", async () => {
        stored.current = { ...EU, trustCountryHeader: true };
        const answer = await onStoreTax(STORE_ANSWER, sale({}, { "cf-ipcountry": "fr" }));
        expect(answer.evidence?.ipCountry).toBe("FR");
        expect(answer).toMatchObject({ country: "FR", rate: 20, reason: "destination" });
        expect(lookups).toHaveLength(0);
    });

    it("reads the header the operator named", async () => {
        stored.current = { ...EU, trustCountryHeader: true, countryHeader: "x-geo-country" };
        const answer = await onStoreTax(STORE_ANSWER, sale({}, { "x-geo-country": "NL", "cf-ipcountry": "FR" }));
        expect(answer.evidence?.ipCountry).toBe("NL");
    });

    it("asks geo.country when no trusted header said, and goes without when nothing answers", async () => {
        const answer = await onStoreTax(STORE_ANSWER, sale());
        expect(lookups).toEqual([{ ip: "198.51.100.23" }]);
        expect(answer.evidence?.ipCountry).toBeNull();
    });

    it("takes what an installed lookup answers", async () => {
        lookupAnswer.current = "nl";
        const answer = await onStoreTax(STORE_ANSWER, sale());
        expect(answer.evidence?.ipCountry).toBe("NL");
    });

    it("asks nothing for a sale with no address, such as one made in game", async () => {
        const answer = await onStoreTax(STORE_ANSWER, sale({ channel: "game", ip: null }));
        expect(lookups).toHaveLength(0);
        expect(answer).toMatchObject({ rate: 19, country: null, evidence: { ipMasked: null } });
    });

    it("keeps the address only cut to its network", async () => {
        const answer = await onStoreTax(STORE_ANSWER, sale());
        expect(answer.evidence?.ipMasked).toBe("198.51.100.0");
    });
});

describe("both pieces of evidence together", () => {
    it("decide on the address and flag a connection elsewhere", async () => {
        stored.current = { ...EU, trustCountryHeader: true };
        const answer = await onStoreTax(
            STORE_ANSWER,
            sale({ billing: { kind: "individual", country: "FR", taxNumber: "" } }, { "cf-ipcountry": "NL" }),
        );
        expect(answer).toMatchObject({ country: "FR", rate: 20 });
        expect(answer.evidence).toMatchObject({ billingCountry: "FR", ipCountry: "NL", conflict: true });
    });
});

describe("the store's own answer", () => {
    it("stands until the operator first saves the tax screen", async () => {
        stored.current = null;
        expect(await onStoreTax(STORE_ANSWER, sale())).toBe(STORE_ANSWER);
        expect(lookups).toHaveLength(0);
    });

    it("is replaced once the screen is saved", async () => {
        expect(await onStoreTax(STORE_ANSWER, sale())).toMatchObject({ rate: 19, label: { kind: "preset", id: "vat" } });
    });
});

describe("asking for a billing address", () => {
    it("is only switched on, never off", async () => {
        stored.current = { ...EU, requireBillingAddress: false };
        expect(await onBillingRequired(false, { currency: "EUR", total: 10 })).toBe(false);
        expect(await onBillingRequired(true, { currency: "EUR", total: 10 })).toBe(true);
        stored.current = { ...EU, requireBillingAddress: true };
        expect(await onBillingRequired(false, { currency: "EUR", total: 10 })).toBe(true);
    });
});
