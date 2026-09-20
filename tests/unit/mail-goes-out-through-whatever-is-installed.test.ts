// @vitest-environment node
/**
 * Core builds the message; whatever is installed sends it.
 *
 * Measured on 2026-09-20: `email.ts` imported `resend`, constructed
 * `new Resend(apiKey)` and called `resend.emails.send(...)`. Core named a
 * vendor, there was exactly one way to send mail on this platform, and an
 * operator with an SMTP relay had nowhere to put it. Half the contract was
 * already right - `emailProvider` in a manifest tells core *which settings key
 * holds the credential*, because "core used to read that key by its literal
 * name, which is core naming a module" - and the other half, the sending, was
 * still core's.
 *
 * A mail provider is a module now, the same shape as a storage provider: the
 * manifest names a handler, the generator collects them, and core resolves the
 * one the operator chose. Called directly rather than through the hook bus,
 * deliberately: every listener there is raced against a five second timeout,
 * and an SMTP send that times out at the bus while arriving at the relay is a
 * message the queue would send twice.
 *
 * An install with exactly one provider needs no setting. That is every install
 * that exists today, and asking them to choose between one thing would be a
 * migration for nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sent: Record<string, unknown>[] = [];
let installed: Record<string, () => Promise<unknown>> = {};
let configured = new Set<string>();
let chosen: string | null = null;
let sendThrows: Error | null = null;
let moduleStates: Record<string, boolean> = {};

function provider(id: string) {
    return {
        isConfigured: async () => configured.has(id),
        send: async (message: Record<string, unknown>) => {
            if (sendThrows) throw sendThrows;
            sent.push({ provider: id, ...message });
        },
    };
}

vi.mock("@/core/generated/module-email", () => ({
    get EmailProviderRegistry() { return installed; },
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => moduleStates }));
vi.mock("@/core/lib/setting-values", () => ({
    readSettingValues: async () => ({ email_active_provider: chosen }),
}));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => String(e),
}));

const { resolveMailer, activeProviderId } = await import("@/core/lib/mailer");

beforeEach(() => {
    sent.length = 0;
    sendThrows = null;
    chosen = null;
    configured = new Set();
    installed = {};
    moduleStates = {};
    vi.resetModules();
});

describe("an install with nothing that can send", () => {
    it("has no mailer, which is what turns a send into a suppressed log line", async () => {
        expect(await resolveMailer()).toBeNull();
    });
});

describe("an install with one provider", () => {
    beforeEach(() => {
        installed = { "resend-provider": async () => provider("resend-provider") };
    });

    it("uses it without being asked to choose between one thing", async () => {
        configured.add("resend-provider");
        const mailer = await resolveMailer();
        expect(mailer).not.toBeNull();
        await mailer!.send({ from: "A <a@b.test>", to: "c@d.test", subject: "Hi", html: "<p>Hi</p>" });
        expect(sent).toEqual([{ provider: "resend-provider", from: "A <a@b.test>", to: "c@d.test", subject: "Hi", html: "<p>Hi</p>" }]);
    });

    it("has no mailer while that provider has no credential", async () => {
        expect(await resolveMailer()).toBeNull();
    });
});

describe("an install with two", () => {
    beforeEach(() => {
        installed = {
            "resend-provider": async () => provider("resend-provider"),
            "smtp-provider": async () => provider("smtp-provider"),
        };
        configured.add("resend-provider");
        configured.add("smtp-provider");
    });

    it("uses the one the operator chose", async () => {
        chosen = "smtp-provider";
        await (await resolveMailer())!.send({ from: "f", to: "t", subject: "s", html: "h" });
        expect(sent[0].provider).toBe("smtp-provider");
    });

    it("sends through nobody when the operator has not chosen", async () => {
        // Picking one for them would mean mail leaving through a relay the
        // operator did not name, which is worse than mail not leaving.
        expect(await resolveMailer()).toBeNull();
    });

    it("sends through nobody when the chosen one is not installed", async () => {
        chosen = "a-module-that-was-uninstalled";
        expect(await resolveMailer()).toBeNull();
    });

    it("sends through nobody when the chosen one has no credential", async () => {
        configured.delete("smtp-provider");
        chosen = "smtp-provider";
        expect(await resolveMailer()).toBeNull();
    });

    it("says which one is active, for the screen that asks", async () => {
        chosen = "smtp-provider";
        expect(await activeProviderId()).toBe("smtp-provider");
    });

    it("sends through the other one when the chosen module is switched off", async () => {
        // A transport an operator took away is not a transport, and with two
        // installed the survivor is the only answer left.
        chosen = "smtp-provider";
        moduleStates = { "smtp-provider": false };
        await (await resolveMailer())!.send({ from: "f", to: "t", subject: "s", html: "h" });
        expect(sent[0].provider).toBe("resend-provider");
    });

    it("sends through nobody when both are switched off", async () => {
        moduleStates = { "smtp-provider": false, "resend-provider": false };
        expect(await resolveMailer()).toBeNull();
    });
});

describe("a provider that fails", () => {
    it("says so rather than swallowing it, because the queue retries on a failure", async () => {
        installed = { "resend-provider": async () => provider("resend-provider") };
        configured.add("resend-provider");
        sendThrows = new Error("relay refused");
        const mailer = await resolveMailer();
        await expect(mailer!.send({ from: "f", to: "t", subject: "s", html: "h" }))
            .rejects.toThrow("relay refused");
    });
});

describe("core itself", () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

    it("names no mail vendor", () => {
        const source = read("src/core/lib/email.ts");
        expect(source).not.toMatch(/\bresend\b/i);
    });

    it("asks the mailer instead", () => {
        expect(read("src/core/lib/email.ts")).toContain("resolveMailer");
    });

    it("declares the handler in the manifest schema and collects it", () => {
        expect(read("src/core/lib/module-manifest-schema.ts")).toMatch(/emailProvider[\s\S]{0,900}handler/);
        expect(read("scripts/generate-registry.ts")).toContain("EmailProviderRegistry");
    });
});
