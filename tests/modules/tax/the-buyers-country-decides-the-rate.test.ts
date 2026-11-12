/**
 * The buyer's country decides the rate, and the order says why.
 *
 * A shop had one tax rate for every buyer in the world. That is right for a
 * shop that only sells at home and wrong for nearly everyone else: inside a
 * tax area such as the EU a seller charges the buyer's own country's rate, a
 * company abroad that gives a tax number accounts for the tax itself, and a
 * sale outside the area is often an export at zero. Each of those is a rule an
 * operator can switch on here, and each answer carries its reason so an
 * invoice for a foreign buyer can say why it has no tax on it.
 *
 * The country comes from the billing address, and the connection's country is
 * kept beside it as a second piece of evidence. Where they disagree the sale
 * goes through on the address and the disagreement is flagged for a person.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, EU_STANDARD_RATES, maskIp, readConfig, taxFor, type Buyer, type TaxConfig } from "@/modules/tax/lib/rules";

const config = (change: Partial<TaxConfig> = {}): TaxConfig => ({ ...DEFAULT_CONFIG, countryRates: {}, ...change });

const buyer = (change: Partial<Buyer> = {}): Buyer => ({
    billingCountry: null,
    kind: "individual",
    taxNumber: "",
    ipCountry: null,
    ipMasked: null,
    ...change,
});

const EU = config({ sellerCountry: "DE", defaultRate: 19, countryRates: { DE: 19, FR: 20, NL: 21 }, labelPreset: "vat" });

describe("the rate", () => {
    it("is the default for a buyer nobody knows the country of", () => {
        expect(taxFor(EU, buyer())).toMatchObject({ rate: 19, reason: "standard", country: null });
    });

    it("is the seller's own for a buyer at home", () => {
        expect(taxFor(EU, buyer({ billingCountry: "DE" }))).toMatchObject({ rate: 19, reason: "domestic", country: "DE" });
    });

    it("is the buyer's country's rate inside the tax area", () => {
        expect(taxFor(EU, buyer({ billingCountry: "FR" }))).toMatchObject({ rate: 20, reason: "destination", country: "FR" });
    });

    it("is zero for a company abroad with a tax number, where the operator applies the reverse charge", () => {
        const company = buyer({ billingCountry: "NL", kind: "company", taxNumber: "NL123456789B01" });
        expect(taxFor({ ...EU, reverseCharge: true }, company)).toMatchObject({ rate: 0, reason: "reverse_charge" });
        // Off, the company pays its country's rate like anyone else.
        expect(taxFor(EU, company)).toMatchObject({ rate: 21, reason: "destination" });
    });

    it("does not reverse-charge a company that gave no tax number", () => {
        const company = buyer({ billingCountry: "NL", kind: "company", taxNumber: "  " });
        expect(taxFor({ ...EU, reverseCharge: true }, company)).toMatchObject({ rate: 21, reason: "destination" });
    });

    it("does not reverse-charge a company at home", () => {
        const company = buyer({ billingCountry: "DE", kind: "company", taxNumber: "DE123" });
        expect(taxFor({ ...EU, reverseCharge: true }, company)).toMatchObject({ rate: 19, reason: "domestic" });
    });

    it("is zero as an export outside the tax area, where the operator says so", () => {
        expect(taxFor({ ...EU, outsideArea: "zero" }, buyer({ billingCountry: "US" }))).toMatchObject({
            rate: 0,
            reason: "export",
            country: "US",
        });
    });

    it("is the default outside the tax area otherwise", () => {
        expect(taxFor(EU, buyer({ billingCountry: "US" }))).toMatchObject({ rate: 19, reason: "standard" });
    });

    it("says a sale at zero at home is exempt, not standard", () => {
        const none = config({ sellerCountry: "GB", defaultRate: 0 });
        expect(taxFor(none, buyer({ billingCountry: "GB" }))).toMatchObject({ rate: 0, reason: "exempt" });
        expect(taxFor(none, buyer())).toMatchObject({ rate: 0, reason: "exempt" });
    });

    it("uses the table for a shop that has not said where it is", () => {
        const table = config({ defaultRate: 10, countryRates: { AU: 10, NZ: 15 } });
        expect(taxFor(table, buyer({ billingCountry: "NZ" }))).toMatchObject({ rate: 15, reason: "standard" });
    });
});

describe("whether the price holds the tax", () => {
    it("is the operator's one switch, whatever the country", () => {
        const inclusive = { ...EU, pricesIncludeTax: true, outsideArea: "zero" as const };
        expect(taxFor(inclusive, buyer({ billingCountry: "FR" })).included).toBe(true);
        expect(taxFor(inclusive, buyer({ billingCountry: "US" })).included).toBe(true);
        expect(taxFor(EU, buyer({ billingCountry: "FR" })).included).toBe(false);
    });
});

describe("the label", () => {
    it("is a known name the site translates", () => {
        expect(taxFor(EU, buyer()).label).toEqual({ kind: "preset", id: "vat" });
    });

    it("is the operator's own words when they chose to write them", () => {
        const own = config({ labelPreset: "custom", labelText: "Consumption tax" });
        expect(taxFor(own, buyer()).label).toEqual({ kind: "custom", text: "Consumption tax" });
    });

    it("falls back to the plain word when the operator chose their own and wrote nothing", () => {
        expect(taxFor(config({ labelPreset: "custom", labelText: "" }), buyer()).label).toEqual({ kind: "preset", id: "tax" });
    });
});

describe("the evidence", () => {
    it("decides on the billing address and keeps the connection's country beside it", () => {
        const answer = taxFor(EU, buyer({ billingCountry: "FR", ipCountry: "FR", ipMasked: "203.0.113.0" }));
        expect(answer.country).toBe("FR");
        expect(answer.evidence).toEqual({ billingCountry: "FR", ipCountry: "FR", ipMasked: "203.0.113.0", conflict: false });
    });

    it("flags an address and a connection in different countries", () => {
        const answer = taxFor(EU, buyer({ billingCountry: "FR", ipCountry: "NL" }));
        expect(answer).toMatchObject({ country: "FR", rate: 20 });
        expect(answer.evidence?.conflict).toBe(true);
    });

    it("goes on the connection's country when there is no address", () => {
        expect(taxFor(EU, buyer({ ipCountry: "NL" }))).toMatchObject({ country: "NL", rate: 21, reason: "destination" });
    });

    it("takes no country from a code that names none", () => {
        // Cloudflare sends XX for unknown and T1 for Tor.
        expect(taxFor(EU, buyer({ ipCountry: "XX" })).country).toBeNull();
        expect(taxFor(EU, buyer({ ipCountry: "T1" })).country).toBeNull();
        expect(taxFor(EU, buyer({ billingCountry: "Germany" })).country).toBeNull();
    });
});

describe("an address kept as evidence", () => {
    it("is cut to its network", () => {
        expect(maskIp("203.0.113.42")).toBe("203.0.113.0");
        expect(maskIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
    });

    it("is nothing when there is none or it is not an address", () => {
        expect(maskIp(null)).toBeNull();
        expect(maskIp("unknown")).toBeNull();
    });
});

describe("the stored settings", () => {
    it("are read rather than trusted", () => {
        const read = readConfig({
            defaultRate: 140,
            sellerCountry: "de",
            countryRates: { fr: "20", Germany: 19, NL: -3 },
            labelPreset: "kdv",
            outsideArea: "zero",
            countryHeader: "CF-IPCountry",
        });
        expect(read.defaultRate).toBe(100);
        expect(read.sellerCountry).toBe("DE");
        expect(read.countryRates).toEqual({ FR: 20, NL: 0 });
        expect(read.labelPreset).toBe("tax");
        expect(read.outsideArea).toBe("zero");
        expect(read.countryHeader).toBe("cf-ipcountry");
        expect(read.trustCountryHeader).toBe(false);
    });

    it("are the defaults for a site that never saved any", () => {
        expect(readConfig(null)).toEqual(DEFAULT_CONFIG);
    });

    it("offer every EU member state's standard rate to start from", () => {
        expect(Object.keys(EU_STANDARD_RATES)).toHaveLength(27);
        expect(Object.values(EU_STANDARD_RATES).every((rate) => rate > 0 && rate < 30)).toBe(true);
    });
});
