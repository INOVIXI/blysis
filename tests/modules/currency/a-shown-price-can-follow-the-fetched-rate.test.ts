// @vitest-environment node
/**
 * A shown price can follow the rate the checkout charges with.
 *
 * The currency list carries a rate the operator typed, and the footer shows
 * prices in it. The checkout converts with the fetched rates instead. With 51
 * typed for the lira and 50.24 fetched, a buyer read one price and paid
 * another, and the typed one went stale the day it was saved.
 *
 * So the list can say "use the fetched rates". The fetched rows are per
 * dollar and the list may have any base, so each rate is rebased: how many of
 * a currency make one of the base is its row over the base's row. A currency
 * nothing has fetched keeps its typed rate and says so, rather than vanishing
 * from the picker or being shown at a rate of nothing.
 *
 * Off by default: a site that typed its rates on purpose keeps them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let storedConfig: unknown = null;
let fetchedRows: { currency: string; rate: number }[] = [];
const upsert = vi.fn(async ({ create, update }: { create?: unknown; update?: unknown }) => update ?? create);

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    prisma: {
        setting: {
            findUnique: vi.fn(async () => (storedConfig ? { value: storedConfig } : null)),
            upsert: (args: never) => upsert(args),
        },
        exchangeRate: {
            findMany: vi.fn(async ({ where }: { where?: { currency?: { in?: string[] } } } = {}) => {
                const wanted = where?.currency?.in;
                return fetchedRows.filter((row) => !wanted || wanted.includes(row.currency));
            }),
        },
    },
    isAdmin: vi.fn(async () => true),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "u1", role: "admin" } })),
}));

const { GET, POST } = await import("@/modules/currency/api/route");

interface Shown {
    code: string;
    rate: number;
    manualRate: number;
    liveRate: number | null;
    rateSource: "fetched" | "manual";
}

async function shown(): Promise<{ useFetchedRates: boolean; currencies: Shown[] }> {
    const res = await GET();
    return res.json();
}

const of = (list: Shown[], code: string) => {
    const found = list.find((c) => c.code === code);
    if (!found) throw new Error(`no ${code}`);
    return found;
};

const USD = { code: "USD", name: "US Dollar", symbol: "$", rate: 1, enabled: true };
const EUR = { code: "EUR", name: "Euro", symbol: "€", rate: 0.95, enabled: true };
const TRY = { code: "TRY", name: "Turkish Lira", symbol: "₺", rate: 51, enabled: true };
const GBP = { code: "GBP", name: "Pound", symbol: "£", rate: 0.8, enabled: true };

beforeEach(() => {
    upsert.mockClear();
    fetchedRows = [
        { currency: "USD", rate: 1 },
        { currency: "EUR", rate: 0.89 },
        { currency: "TRY", rate: 50.24 },
    ];
});

describe("the shown rate", () => {
    it("is the typed one while the switch is off", async () => {
        storedConfig = { base: "USD", currencies: [USD, TRY] };
        const body = await shown();
        expect(body.useFetchedRates).toBe(false);
        expect(of(body.currencies, "TRY").rate).toBe(51);
        expect(of(body.currencies, "TRY").rateSource).toBe("manual");
        // The admin screen still sees what was fetched, to decide by.
        expect(of(body.currencies, "TRY").liveRate).toBe(50.24);
    });

    it("is the fetched one while the switch is on", async () => {
        storedConfig = { base: "USD", useFetchedRates: true, currencies: [USD, EUR, TRY] };
        const body = await shown();
        expect(of(body.currencies, "TRY").rate).toBe(50.24);
        expect(of(body.currencies, "TRY").rateSource).toBe("fetched");
        expect(of(body.currencies, "EUR").rate).toBe(0.89);
        expect(of(body.currencies, "USD").rate).toBe(1);
        // What was typed is kept for the day the switch goes off again.
        expect(of(body.currencies, "TRY").manualRate).toBe(51);
    });

    it("is rebased when the list's base is not the dollar", async () => {
        storedConfig = {
            base: "TRY",
            useFetchedRates: true,
            currencies: [{ ...TRY, rate: 1 }, { ...USD, rate: 0.02 }, { ...EUR, rate: 0.018 }],
        };
        const body = await shown();
        expect(of(body.currencies, "TRY").rate).toBe(1);
        // One lira buys 1/50.24 of a dollar, and 0.89/50.24 of a euro.
        expect(of(body.currencies, "USD").rate).toBeCloseTo(1 / 50.24, 12);
        expect(of(body.currencies, "EUR").rate).toBeCloseTo(0.89 / 50.24, 12);
    });

    it("keeps the typed rate for a currency nothing has fetched, and says so", async () => {
        storedConfig = { base: "USD", useFetchedRates: true, currencies: [USD, TRY, GBP] };
        const body = await shown();
        expect(of(body.currencies, "GBP").rate).toBe(0.8);
        expect(of(body.currencies, "GBP").rateSource).toBe("manual");
        expect(of(body.currencies, "GBP").liveRate).toBeNull();
    });

    it("keeps every typed rate when the base itself has no fetched row", async () => {
        // Rebasing through a base with no rate would divide by nothing.
        storedConfig = { base: "GBP", useFetchedRates: true, currencies: [{ ...GBP, rate: 1 }, { ...TRY, rate: 64 }] };
        const body = await shown();
        expect(of(body.currencies, "TRY").rate).toBe(64);
        expect(of(body.currencies, "TRY").rateSource).toBe("manual");
    });
});

describe("saving the switch", () => {
    function post(body: unknown) {
        return POST(
            new Request("http://localhost/api/v1/currency", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }) as never,
        );
    }

    it("stores it when it is sent", async () => {
        const res = await post({ base: "USD", useFetchedRates: true, currencies: [USD, TRY] });
        expect(res.status).toBe(200);
        expect((await res.json()).useFetchedRates).toBe(true);
    });

    it("is off when a save does not mention it", async () => {
        const res = await post({ base: "USD", currencies: [USD, TRY] });
        expect((await res.json()).useFetchedRates).toBe(false);
    });
});
