// @vitest-environment node
/**
 * Every webhook this site sends becomes a row here.
 *
 * Measured on 2026-09-20: this module read `WebhookLog`, searched it, paged it
 * and expired it after thirty days - and nothing in the tree ever inserted a
 * row. No POST, no listener, no core call. The screen was permanently empty by
 * construction, so the seed the list asked for would have read as proof that
 * deliveries were being recorded, which was the opposite of true.
 *
 * Core announces a delivery it made and this writes it down. Core does not
 * know this table's name and does not need to.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const written: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        webhookLog: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                written.push(data);
                return { id: "w1" };
            },
        },
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const record = (await import("../../../module-sources/webhook-logs/hooks/on-webhook-delivered")).default;

const delivered = (over: Record<string, unknown> = {}) =>
    record({
        event: "core.health",
        url: "https://discord.com",
        status: 204,
        ok: true,
        detail: null,
        ...over,
    } as never);

beforeEach(() => { written.length = 0; });

describe("a delivery that arrived", () => {
    it("is one row, with what it was and where it went", async () => {
        await delivered();
        expect(written).toHaveLength(1);
        expect(written[0]).toMatchObject({ event: "core.health", url: "https://discord.com", status: 204 });
    });

    it("keeps no copy of what was sent", async () => {
        // The body is built from the event and is reconstructible; what an
        // operator needs when a delivery fails is what the receiver said.
        await delivered();
        expect(written[0].payload ?? null).toBeNull();
    });
});

describe("a delivery that did not", () => {
    it("is a row too, which is the one somebody goes looking for", async () => {
        await delivered({ status: 400, ok: false, detail: "embeds[0].description" });
        expect(written[0]).toMatchObject({ status: 400, response: "embeds[0].description" });
    });

    it("keeps its status at zero when the request never got an answer", async () => {
        await delivered({ status: 0, ok: false, detail: "fetch failed" });
        expect(written[0].status).toBe(0);
    });
});

describe("a row that cannot be written", () => {
    it("does not take the delivery down with it", async () => {
        vi.resetModules();
        vi.doMock("@/core/sdk/server", () => ({
            prisma: { webhookLog: { create: async () => { throw new Error("no database"); } } },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        }));
        const again = (await import("../../../module-sources/webhook-logs/hooks/on-webhook-delivered")).default;
        await expect(again({ event: "core.health", url: "https://discord.com", status: 204, ok: true, detail: null } as never))
            .resolves.toBeUndefined();
        vi.doUnmock("@/core/sdk/server");
        vi.resetModules();
    });
});
