// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Health alerting is the thing that tells an operator the platform is
 * down. Every failure mode here is silent by construction: a debounce that
 * is too eager means no page ever arrives, one that is too lax means the
 * channel is spammed until it is muted, and a malformed Setting row must
 * degrade to "disabled" rather than throw inside a cron tick.
 *
 * The webhook-channels module is used for real rather than mocked - the
 * URL validation it performs (https only, no private hosts) is part of
 * what is being checked here.
 */

const { setting, getModuleStates, ModuleWebhookChannels } = vi.hoisted(() => ({
    setting: { findUnique: vi.fn() },
    getModuleStates: vi.fn(),
    ModuleWebhookChannels: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/core/lib/db", () => ({ prisma: { setting }, default: { setting } }));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates }));
vi.mock("@/core/generated/module-data", () => ({ ModuleWebhookChannels }));
/*
 * Recording a delivery announces it on the hook bus, and filling that bus
 * means importing every module's listeners. In a test environment they cannot
 * resolve, so the first webhook here spent two seconds failing to load ninety
 * of them and printed a line for each - and in the full suite, on a loaded
 * box, those two seconds crossed vitest's five second ceiling and the file
 * went red for a reason that had nothing to do with webhooks.
 *
 * Nothing in this file is about the bus, so it is not built.
 */
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks: async () => {} }));

import {
    HEALTH_ALERTING_SETTING_KEY,
    loadAlertingConfig,
    listAlertingChannels,
    sendHealthWebhook,
    buildTestPayload,
    checkAndAlert,
    getAlertState,
    resetAlertState,
    type HealthAlertingConfig,
} from "@/core/lib/health-alerting";
import { GENERIC_CHANNEL } from "@/core/lib/webhook-channels";

const WEBHOOK = "https://example.com/hooks/health";

interface FetchCall { url: string; init?: RequestInit }

let calls: FetchCall[];
/** Response the internal /api/health endpoint should produce. */
let healthBody: unknown;
let healthThrows: Error | null;
/** Response the webhook endpoint should produce. */
let webhookStatus: number;
let webhookThrows: Error | null;
/** A receiver that refuses and then dies before it finishes saying why. */
let webhookBodyThrows: boolean;

beforeEach(() => {
    calls = [];
    healthBody = { status: "ok", version: "0.2.0" };
    healthThrows = null;
    webhookStatus = 204;
    webhookThrows = null;
    webhookBodyThrows = false;
    ModuleWebhookChannels.length = 0;

    setting.findUnique.mockReset().mockResolvedValue(null);
    getModuleStates.mockReset().mockResolvedValue({});
    resetAlertState();

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/api/health")) {
            if (healthThrows) throw healthThrows;
            return { ok: true, json: async () => healthBody } as unknown as Response;
        }
        if (webhookThrows) throw webhookThrows;
        // `text` because a refusal is read now: what the receiver said is the
        // only useful thing in the webhook log when a delivery does not land.
        return {
            ok: webhookStatus < 400,
            status: webhookStatus,
            text: async () => {
                if (webhookBodyThrows) throw new Error("connection reset");
                return webhookStatus < 400 ? "" : `refused ${webhookStatus}`;
            },
        } as unknown as Response;
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetAlertState();
});

/** Store a health_alerting Setting row. */
function storeConfig(value: unknown): void {
    setting.findUnique.mockResolvedValue({ value });
}

function enabled(over: Record<string, unknown> = {}): void {
    storeConfig({ enabled: true, webhookUrl: WEBHOOK, alertOn: ["degraded", "down"], ...over });
}

const webhookCalls = () => calls.filter((c) => !c.url.includes("/api/health"));

// ===========================================================================

describe("loadAlertingConfig", () => {
    it("reads the health_alerting setting row", async () => {
        await loadAlertingConfig();
        expect(setting.findUnique).toHaveBeenCalledWith({
            where: { key: HEALTH_ALERTING_SETTING_KEY },
        });
    });

    it("returns a disabled config when no row exists", async () => {
        await expect(loadAlertingConfig()).resolves.toEqual({
            enabled: false,
            webhookUrl: "",
            channel: GENERIC_CHANNEL.id,
            alertOn: ["degraded", "down"],
        });
    });

    it("returns a disabled config when the value is not an object", async () => {
        storeConfig("enabled");
        await expect(loadAlertingConfig()).resolves.toMatchObject({ enabled: false });
    });

    it("returns a disabled config when the value is an array", async () => {
        storeConfig([1, 2]);
        await expect(loadAlertingConfig()).resolves.toMatchObject({ enabled: false });
    });

    it("returns a disabled config when the value is null", async () => {
        storeConfig(null);
        await expect(loadAlertingConfig()).resolves.toMatchObject({ enabled: false });
    });

    it("never throws out of a cron tick when the database is down", async () => {
        setting.findUnique.mockRejectedValue(new Error("db down"));
        await expect(loadAlertingConfig()).resolves.toMatchObject({ enabled: false });
    });

    it("reads the stored configuration", async () => {
        storeConfig({
            enabled: true, webhookUrl: WEBHOOK, channel: "slack", alertOn: ["down"],
        });

        await expect(loadAlertingConfig()).resolves.toEqual({
            enabled: true, webhookUrl: WEBHOOK, channel: "slack", alertOn: ["down"],
        });
    });

    it("still honours the pre-registry `provider` key", async () => {
        storeConfig({ enabled: true, webhookUrl: WEBHOOK, provider: "discord" });
        await expect(loadAlertingConfig()).resolves.toMatchObject({ channel: "discord" });
    });

    it("prefers `channel` over the legacy `provider`", async () => {
        storeConfig({ enabled: true, channel: "slack", provider: "discord" });
        await expect(loadAlertingConfig()).resolves.toMatchObject({ channel: "slack" });
    });

    it("falls back to the built-in channel when the stored one is blank", async () => {
        storeConfig({ enabled: true, channel: "" });
        await expect(loadAlertingConfig()).resolves.toMatchObject({ channel: GENERIC_CHANNEL.id });
    });

    it("requires enabled to be exactly true", async () => {
        storeConfig({ enabled: "yes", webhookUrl: WEBHOOK });
        await expect(loadAlertingConfig()).resolves.toMatchObject({ enabled: false });
    });

    it("blanks a non-string webhook url", async () => {
        storeConfig({ enabled: true, webhookUrl: 42 });
        await expect(loadAlertingConfig()).resolves.toMatchObject({ webhookUrl: "" });
    });

    it("drops unrecognised statuses from alertOn", async () => {
        storeConfig({ enabled: true, alertOn: ["down", "banana", 7] });
        await expect(loadAlertingConfig()).resolves.toMatchObject({ alertOn: ["down"] });
    });

    it("falls back to the default when alertOn filters down to nothing", async () => {
        storeConfig({ enabled: true, alertOn: ["banana"] });
        await expect(loadAlertingConfig()).resolves.toMatchObject({
            alertOn: ["degraded", "down"],
        });
    });

    it("falls back to the default when alertOn is not an array", async () => {
        storeConfig({ enabled: true, alertOn: "down" });
        await expect(loadAlertingConfig()).resolves.toMatchObject({
            alertOn: ["degraded", "down"],
        });
    });
});

describe("listAlertingChannels", () => {
    it("always offers the built-in channel", async () => {
        await expect(listAlertingChannels()).resolves.toEqual([GENERIC_CHANNEL]);
    });

    it("includes a channel from an enabled module", async () => {
        ModuleWebhookChannels.push({ id: "slack", label: "Slack", layout: "slack", module: "slack-mod" });
        getModuleStates.mockResolvedValue({ "slack-mod": true });

        const ids = (await listAlertingChannels()).map((c) => c.id);
        expect(ids).toContain("slack");
    });

    it("hides a channel whose module is disabled", async () => {
        ModuleWebhookChannels.push({ id: "slack", label: "Slack", layout: "slack", module: "slack-mod" });
        getModuleStates.mockResolvedValue({ "slack-mod": false });

        expect((await listAlertingChannels()).map((c) => c.id)).toEqual(["generic"]);
    });

    it("still offers the built-in channel when module state is unavailable", async () => {
        getModuleStates.mockRejectedValue(new Error("db down"));

        // Failing here would break the settings page during a DB hiccup.
        await expect(listAlertingChannels()).resolves.toEqual([GENERIC_CHANNEL]);
    });
});

describe("sendHealthWebhook", () => {
    const config: HealthAlertingConfig = {
        enabled: true, webhookUrl: WEBHOOK, channel: "generic", alertOn: ["down"],
    };

    it("posts the payload as json", async () => {
        await expect(sendHealthWebhook(config, { a: 1 }, GENERIC_CHANNEL))
            .resolves.toEqual({ ok: true });

        const call = webhookCalls()[0]!;
        expect(call.url).toBe(WEBHOOK);
        expect(call.init?.method).toBe("POST");
        expect(call.init?.body).toBe('{"a":1}');
    });

    it("refuses an empty url without dialling out", async () => {
        await expect(sendHealthWebhook({ ...config, webhookUrl: "" }, {}, GENERIC_CHANNEL))
            .resolves.toEqual({ ok: false, error: "No webhook URL" });
        expect(webhookCalls()).toHaveLength(0);
    });

    it("refuses a malformed url", async () => {
        await expect(sendHealthWebhook({ ...config, webhookUrl: "not a url" }, {}, GENERIC_CHANNEL))
            .resolves.toMatchObject({ ok: false });
        expect(webhookCalls()).toHaveLength(0);
    });

    it("refuses plain http", async () => {
        await expect(sendHealthWebhook({ ...config, webhookUrl: "http://example.com/h" }, {}, GENERIC_CHANNEL))
            .resolves.toEqual({ ok: false, error: "Webhook URL must use https" });
    });

    it("refuses a private host, which would make this an SSRF primitive", async () => {
        await expect(sendHealthWebhook({ ...config, webhookUrl: "https://127.0.0.1/h" }, {}, GENERIC_CHANNEL))
            .resolves.toMatchObject({ ok: false });
        expect(webhookCalls()).toHaveLength(0);
    });

    // validateWebhookUrl only ever sees the URL an admin typed. A public host
    // that answers 302 with `Location: http://127.0.0.1:3101/...` moves the
    // request somewhere the validator never looked, and fetch follows up to
    // twenty of those by default. Measured directly: a default fetch at a
    // redirecting host reaches the internal service; with `redirect: "manual"`
    // it stops at the 302.
    it("does not let the platform follow a redirect the validator never saw", async () => {
        await sendHealthWebhook(config, { a: 1 }, GENERIC_CHANNEL);

        expect(webhookCalls()[0]!.init?.redirect).toBe("manual");
    });

    it("treats a redirect as a refusal rather than a delivery", async () => {
        webhookStatus = 302;

        await expect(sendHealthWebhook(config, {}, GENERIC_CHANNEL))
            .resolves.toEqual({
                ok: false,
                error: "Webhook URL redirected, which is not followed",
            });
    });

    it("reports a non-2xx response as a failure", async () => {
        webhookStatus = 500;
        await expect(sendHealthWebhook(config, {}, GENERIC_CHANNEL))
            .resolves.toEqual({ ok: false, error: "HTTP 500" });
    });

    it("still reports the refusal when the receiver dies before saying why", async () => {
        // The body is read for the webhook log; a receiver that drops the
        // connection mid-answer must not turn a 500 into a thrown request.
        webhookStatus = 500;
        webhookBodyThrows = true;
        await expect(sendHealthWebhook(config, {}, GENERIC_CHANNEL))
            .resolves.toEqual({ ok: false, error: "HTTP 500" });
    });

    it("reports a transport failure with its message", async () => {
        webhookThrows = new Error("ETIMEDOUT");
        await expect(sendHealthWebhook(config, {}, GENERIC_CHANNEL))
            .resolves.toEqual({ ok: false, error: "ETIMEDOUT" });
    });

    it("resolves the channel from the config when none is passed", async () => {
        await expect(sendHealthWebhook(config, { a: 1 })).resolves.toEqual({ ok: true });
    });
});

describe("buildTestPayload", () => {
    it("produces a payload the admin test button can send", () => {
        const payload = buildTestPayload(GENERIC_CHANNEL);
        expect(payload).toBeTypeOf("object");
        expect(JSON.stringify(payload)).toContain("ok");
    });
});

describe("checkAndAlert", () => {
    it("does nothing when alerting is disabled", async () => {
        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "disabled" });
        expect(calls).toHaveLength(0);
    });

    it("does nothing when no webhook url is configured", async () => {
        enabled({ webhookUrl: "" });
        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "disabled" });
        expect(calls).toHaveLength(0);
    });

    it("polls health over the loopback interface, not the public host", async () => {
        enabled();
        vi.stubEnv("PORT", "4321");

        await checkAndAlert();

        // Using the configured Host would make this spoofable.
        expect(calls[0]!.url).toBe("http://127.0.0.1:4321/api/health");
    });

    it("defaults to port 3001", async () => {
        enabled();
        vi.stubEnv("PORT", "");
        await checkAndAlert();
        expect(calls[0]!.url).toContain(":3001/");
    });

    it("stays quiet while everything is healthy", async () => {
        enabled();
        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "ok" });
        expect(webhookCalls()).toHaveLength(0);
    });

    it("alerts on the transition into a bad state", async () => {
        enabled();
        healthBody = { status: "down", version: "0.2.0" };

        await expect(checkAndAlert()).resolves.toEqual({ notified: true, status: "down" });
        expect(webhookCalls()).toHaveLength(1);
    });

    it("treats an unreachable health endpoint as down", async () => {
        enabled();
        healthThrows = new Error("ECONNREFUSED");

        await expect(checkAndAlert()).resolves.toMatchObject({ status: "down" });
    });

    it("treats an unrecognised status as down", async () => {
        enabled();
        healthBody = { status: "weird" };

        await expect(checkAndAlert()).resolves.toMatchObject({ status: "down" });
    });

    it("debounces a repeat of the same bad state", async () => {
        enabled();
        healthBody = { status: "down" };
        await checkAndAlert();

        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "down" });
        expect(webhookCalls()).toHaveLength(1);
    });

    it("re-alerts once the debounce window has passed", async () => {
        vi.useFakeTimers();
        enabled();
        healthBody = { status: "down" };
        await checkAndAlert();

        vi.setSystemTime(Date.now() + 15 * 60_000);
        await expect(checkAndAlert()).resolves.toEqual({ notified: true, status: "down" });
    });

    it("still debounces just inside the window", async () => {
        vi.useFakeTimers();
        enabled();
        healthBody = { status: "down" };
        await checkAndAlert();

        vi.setSystemTime(Date.now() + 15 * 60_000 - 1);
        await expect(checkAndAlert()).resolves.toMatchObject({ notified: false });
    });

    it("alerts again when a bad state gets worse", async () => {
        enabled();
        healthBody = { status: "degraded" };
        await checkAndAlert();

        healthBody = { status: "down" };
        await expect(checkAndAlert()).resolves.toEqual({ notified: true, status: "down" });
    });

    it("announces recovery even when 'ok' is not in alertOn", async () => {
        enabled({ alertOn: ["down"] });
        healthBody = { status: "down" };
        await checkAndAlert();

        healthBody = { status: "ok" };
        await expect(checkAndAlert()).resolves.toEqual({ notified: true, status: "ok" });
        expect(String(webhookCalls()[1]!.init?.body)).toContain("recovered");
    });

    it("honours an admin who only wants to hear about outages", async () => {
        enabled({ alertOn: ["down"] });
        healthBody = { status: "degraded" };

        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "degraded" });
        expect(webhookCalls()).toHaveLength(0);
    });

    it("still records an un-alerted status, so the next change is a transition", async () => {
        enabled({ alertOn: ["down"] });
        healthBody = { status: "degraded" };
        await checkAndAlert();

        expect(getAlertState().lastStatus).toBe("degraded");
    });

    it("reports not-notified when the webhook itself fails", async () => {
        enabled();
        healthBody = { status: "down" };
        webhookStatus = 500;

        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "down" });
    });

    it("does not start the debounce clock on a failed send", async () => {
        enabled();
        healthBody = { status: "down" };
        webhookStatus = 500;
        await checkAndAlert();

        expect(getAlertState().lastNotifiedAt).toBeNull();
        // So the very next tick retries rather than waiting fifteen minutes.
        webhookStatus = 204;
        await expect(checkAndAlert()).resolves.toMatchObject({ notified: true });
    });

    it("starts the debounce clock on a successful send", async () => {
        enabled();
        healthBody = { status: "down" };
        await checkAndAlert();

        expect(getAlertState().lastNotifiedAt).toBeInstanceOf(Date);
    });

    it("refuses to post to a private host even when configured to", async () => {
        enabled({ webhookUrl: "https://192.168.1.10/hook" });
        healthBody = { status: "down" };

        await expect(checkAndAlert()).resolves.toEqual({ notified: false, status: "down" });
        expect(webhookCalls()).toHaveLength(0);
    });
});

describe("alert state", () => {
    it("starts out ok and un-notified", () => {
        expect(getAlertState()).toEqual({ lastStatus: "ok", lastNotifiedAt: null });
    });

    it("hands back a copy, not the live object", async () => {
        const snapshot = getAlertState();
        snapshot.lastStatus = "down";

        expect(getAlertState().lastStatus).toBe("ok");
    });

    it("is cleared by resetAlertState", async () => {
        enabled();
        healthBody = { status: "down" };
        await checkAndAlert();

        resetAlertState();

        expect(getAlertState()).toEqual({ lastStatus: "ok", lastNotifiedAt: null });
    });
});
