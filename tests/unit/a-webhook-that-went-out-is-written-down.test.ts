// @vitest-environment node
/**
 * A webhook this site sent leaves a record, and the record is not a credential.
 *
 * Measured on 2026-09-20: `WebhookLog` was read by its module's list endpoint,
 * searched, paged and expired after thirty days by its cron - and nothing in
 * the tree ever inserted a row. No POST, no listener, no core call. The screen
 * was permanently empty by construction, so an operator asking "did the alert
 * go out at three?" had a table that could only ever answer no.
 *
 * Core does send: a health alert on a schedule, and the same call behind the
 * panel's test button. It recorded nothing. It says so now, through a hook,
 * because the table belongs to a module and core may not know its name.
 *
 * The address is redacted to its origin, and that is the whole point rather
 * than a detail. A webhook URL is a credential - Discord's is
 * `https://discord.com/api/webhooks/<id>/<token>` - and a log is listed,
 * searched and kept for a month after the key it holds has been rotated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fired: { name: string; payload: Record<string, unknown> }[] = [];

vi.mock("@/core/lib/hooks", () => ({
    doActionAsync: async (name: string, payload: Record<string, unknown>) => {
        fired.push({ name, payload });
    },
    applyFiltersAsync: async (_n: string, value: unknown) => value,
}));
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks: async () => {} }));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => String(e),
}));

const { redactWebhookTarget, recordWebhookDelivery } = await import("@/core/lib/webhook-log");

const DISCORD = "https://discord.com/api/webhooks/123456789/AbCdEf-GhIjKlMnOpQrStUvWxYz";

beforeEach(() => { fired.length = 0; });

describe("what is written down about where it went", () => {
    it("is the origin, never the token in the path", () => {
        expect(redactWebhookTarget(DISCORD)).toBe("https://discord.com");
    });

    it("keeps the host, so two receivers are still two receivers", () => {
        expect(redactWebhookTarget("https://ops.example.com/hooks/health")).toBe("https://ops.example.com");
        expect(redactWebhookTarget("https://hooks.slack.test/services/T/B/XXXX")).toBe("https://hooks.slack.test");
    });

    it("drops a query string, which is where a key is put when it is not in the path", () => {
        expect(redactWebhookTarget("https://ops.example.com/h?key=s3cret")).toBe("https://ops.example.com");
    });

    it("keeps the port, because that is how a receiver is reached and not a secret", () => {
        expect(redactWebhookTarget("https://ops.example.com:8443/h")).toBe("https://ops.example.com:8443");
    });

    it("says nothing at all about an address it cannot read", () => {
        expect(redactWebhookTarget("not a url")).toBe("");
        expect(redactWebhookTarget("")).toBe("");
    });
});

describe("a delivery that was attempted", () => {
    it("is announced, so whatever keeps the log can write it", async () => {
        await recordWebhookDelivery({ event: "core.health", url: DISCORD, status: 204, ok: true, detail: null });

        expect(fired).toHaveLength(1);
        expect(fired[0].name).toBe("core.webhook.delivered");
        expect(fired[0].payload).toEqual({
            event: "core.health",
            url: "https://discord.com",
            status: 204,
            ok: true,
            detail: null,
        });
    });

    it("is announced when it failed, which is the one somebody goes looking for", async () => {
        await recordWebhookDelivery({ event: "core.health", url: DISCORD, status: 400, ok: false, detail: "embeds[0]" });

        expect(fired[0].payload).toMatchObject({ status: 400, ok: false, detail: "embeds[0]" });
    });

    it("carries no part of the token, however it was called", async () => {
        await recordWebhookDelivery({ event: "core.health", url: DISCORD, status: 0, ok: false, detail: DISCORD });

        const said = JSON.stringify(fired[0].payload);
        expect(said).not.toContain("AbCdEf-GhIjKlMnOpQrStUvWxYz");
        expect(said).not.toContain("123456789");
    });

    it("bounds what the receiver said, because a receiver can answer with a page", async () => {
        await recordWebhookDelivery({ event: "core.health", url: DISCORD, status: 500, ok: false, detail: "x".repeat(5000) });

        expect((fired[0].payload.detail as string).length).toBeLessThanOrEqual(500);
    });

    it("does not take a delivery down when nothing is listening and the bus throws", async () => {
        vi.resetModules();
        vi.doMock("@/core/lib/hooks", () => ({
            doActionAsync: async () => { throw new Error("the bus is broken"); },
        }));
        const { recordWebhookDelivery: record } = await import("@/core/lib/webhook-log");
        await expect(record({ event: "core.health", url: DISCORD, status: 204, ok: true, detail: null }))
            .resolves.toBeUndefined();
        vi.doUnmock("@/core/lib/hooks");
        vi.resetModules();
    });
});

describe("the two places core sends one", () => {
    it("both go through the one function, so neither has to remember", async () => {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const source = fs.readFileSync(path.join(process.cwd(), "src/core/lib/health-alerting.ts"), "utf8");
        expect(source).toContain("recordWebhookDelivery");
    });
});
