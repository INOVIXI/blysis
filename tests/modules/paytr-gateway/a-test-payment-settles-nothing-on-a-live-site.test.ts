// @vitest-environment node
/**
 * A payment PayTR made in test mode settles nothing on a site that is live.
 *
 * PayTR runs a merchant account in test mode until it is approved, and in
 * test mode it takes its published test cards and reports each payment as a
 * success, signed like any other. A site that left test mode in the account
 * but not in its own settings granted every such order for nothing. PayTR
 * says which mode a payment ran in with `test_mode` on the callback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const settings: { value: Record<string, string | null> } = { value: {} };
const filters = vi.fn(async (name: string, initial: unknown) =>
    name === "payment.settled" || name === "payment.voided" ? { handled: true, duplicate: false, error: null } : initial,
);

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => settings.value,
}));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: filters }));

const { POST } = await import("../../../module-sources/paytr-gateway/api/callback/route");

function callback(fields: Record<string, string>) {
    const hash = crypto
        .createHmac("sha256", "key")
        .update(fields.merchant_oid + "salt" + fields.status + fields.total_amount)
        .digest("base64");
    const form = new FormData();
    for (const [name, value] of Object.entries({ ...fields, hash })) form.set(name, value);
    return POST(new Request("https://example.com/api/v1/paytr/callback", { method: "POST", body: form }) as never);
}

const paid = { merchant_oid: "order1", status: "success", total_amount: "10000" };

beforeEach(() => {
    filters.mockClear();
    settings.value = { paytr_merchant_id: "123", paytr_merchant_key: "key", paytr_merchant_salt: "salt", paytr_test_mode: "false" };
});

describe("a PayTR callback", () => {
    it("settles nothing for a test payment when the site is live, and stops the retries", async () => {
        const res = await callback({ ...paid, test_mode: "1" });
        expect(await res.text()).toBe("OK");
        expect(filters).not.toHaveBeenCalled();
    });

    it("settles a test payment while the site is in test mode", async () => {
        settings.value = { ...settings.value, paytr_test_mode: "true" };
        const res = await callback({ ...paid, test_mode: "1" });
        expect(await res.text()).toBe("OK");
        expect(filters).toHaveBeenCalledWith("payment.settled", expect.anything(), expect.objectContaining({ reference: "order1" }));
    });

    it("settles a live payment", async () => {
        const res = await callback({ ...paid, test_mode: "0" });
        expect(await res.text()).toBe("OK");
        expect(filters).toHaveBeenCalledWith("payment.settled", expect.anything(), expect.objectContaining({ amount: 100 }));
    });
});
