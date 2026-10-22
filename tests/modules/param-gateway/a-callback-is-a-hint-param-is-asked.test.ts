// @vitest-environment node
/**
 * Param's callback is the buyer's browser posting back, so it is a hint.
 *
 * The route takes the order id and the receipt id from the post and asks
 * Param, with the site's own terminal credentials, what happened to them. The
 * amount comes from Param's answer, written the Turkish way. Where to send
 * the buyer afterwards came back through the browser too, so only a path on
 * this site is accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({
        param_client_code: "10738",
        param_client_username: "test",
        param_client_password: "pass",
        param_guid: "guid-1",
        param_test_mode: "true",
    }),
    resolveAppUrl: async () => "https://shop.example",
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/param-gateway/api/callback/route");
const { NextRequest } = await import("next/server");

const fetchMock = vi.fn();

function callback(query = "?to=%2Fstore%2Forder-success&cancel=%2Fstore%2Fcart") {
    return new NextRequest(`https://shop.example/api/v1/param/callback${query}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ TURKPOS_RETVAL_Siparis_ID: "order-1", TURKPOS_RETVAL_Dekont_ID: "rcpt-1" }).toString(),
    });
}

function paramSays(fields: Record<string, string>) {
    const tags = Object.entries(fields).map(([tag, value]) => `<${tag}>${value}</${tag}>`).join("");
    fetchMock.mockResolvedValueOnce(new Response(`<soap:Envelope><soap:Body>${tags}</soap:Body></soap:Envelope>`));
}

function settled() {
    const call = applyFiltersAsync.mock.calls.find((c) => (c as unknown[])[0] === "payment.settled") as unknown as
        | [string, unknown, Record<string, unknown>]
        | undefined;
    return call?.[2];
}

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    applyFiltersAsync.mockClear();
    applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: false, error: null });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a Param callback", () => {
    it("asks Param about the order and settles the amount Param reports", async () => {
        paramSays({ Sonuc: "1", Durum: "SATIS", Toplam_Tutar: "1.234,56" });

        const res = await POST(callback());

        const envelope = (fetchMock.mock.calls[0][1] as { body: string }).body;
        expect(envelope).toContain("TP_Islem_Sorgulama4");
        expect(envelope).toContain("<Siparis_ID>order-1</Siparis_ID>");
        expect(envelope).toContain("<CLIENT_CODE>10738</CLIENT_CODE>");
        expect(settled()).toMatchObject({ reference: "order-1", providerRef: "rcpt-1", amount: 1234.56, currency: "TRY" });
        expect(res.headers.get("location")).toBe("https://shop.example/store/order-success");
    });

    it("settles nothing when Param says the order was not paid", async () => {
        paramSays({ Sonuc: "1", Durum: "IPTAL" });

        const res = await POST(callback());

        expect(settled()).toBeUndefined();
        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=payment_failed");
    });

    it("settles nothing when Param's query itself failed", async () => {
        paramSays({ Sonuc: "-1", Durum: "SATIS", Toplam_Tutar: "1.234,56" });

        await POST(callback());

        expect(settled()).toBeUndefined();
    });

    it("sends the buyer nowhere but this site, whatever came back in the query", async () => {
        paramSays({ Sonuc: "1", Durum: "SATIS", Toplam_Tutar: "10,00" });

        const res = await POST(callback("?to=%2F%2Fevil.example&cancel=https%3A%2F%2Fevil.example"));

        expect(res.headers.get("location")).toBe("https://shop.example/store/order-success");
    });

    it("does not tell the buyer it worked when nothing recorded the payment", async () => {
        applyFiltersAsync.mockResolvedValueOnce({ handled: false, duplicate: false, error: "settlement failed" });
        paramSays({ Sonuc: "1", Durum: "SATIS", Toplam_Tutar: "10,00" });

        const res = await POST(callback());

        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=settlement_failed");
    });
});
