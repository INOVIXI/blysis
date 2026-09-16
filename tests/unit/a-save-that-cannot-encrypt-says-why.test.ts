// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What an operator is told when the install has nowhere safe to put a key.
 *
 * Gateway credentials are encrypted at rest now, which makes
 * `SECRET_ENCRYPTION_KEY` load-bearing for every payment module rather than
 * for the one that used to need it. An install that upgrades without setting
 * it cannot store a credential at all.
 *
 * Measured against a production build before this existed: pasting a Stripe
 * key answered 500 with an empty body, under a form that said "could not
 * save". Nothing on the screen, in the response or in the operator's reach
 * mentioned an environment variable, so the only way to the answer was the
 * server log - and the fix is one line of configuration.
 *
 * So the refusal carries a code the screen can turn into a sentence. The
 * message does not repeat the variable's value or a stack trace; it names what
 * failed and what to do, which is what an operator can act on.
 */

const { setting, transaction } = vi.hoisted(() => ({
    setting: {
        findMany: vi.fn(async () => [] as unknown[]),
        upsert: vi.fn((args: unknown) => args),
    },
    transaction: vi.fn(async (calls: unknown[]) => calls),
}));

vi.mock("@/core/lib/db", () => ({
    prisma: { setting, $transaction: transaction },
    default: { setting, $transaction: transaction },
}));
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "u1", role: "admin" } }) }));
// An administrator, which is what this test is about: the refusal it defends
// is the one an operator sees when the install has no key, not a permission
// check standing in front of it.
vi.mock("@/core/lib/permissions", () => ({
    isAdmin: async () => true,
    hasPermission: async () => true,
}));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/cache", () => ({ invalidate: async () => undefined }));
vi.mock("@/core/lib/email-config", () => ({ invalidateEmailConfig: () => undefined }));
vi.mock("@/core/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// One declared credential, so the route has something it must seal. The real
// list comes from the installed modules and would make this test depend on
// which of them happen to be present.
vi.mock("@/core/generated/module-data", () => ({
    ModuleSecretSettings: ["probe_secret_key"],
    ModuleSettings: {},
}));

import { PATCH } from "@/app/api/v1/settings/route";

function request(body: unknown): Request {
    return new Request("http://localhost/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("saving a credential on an install with no encryption key", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        transaction.mockClear();
    });

    it("is refused with a code the screen can explain", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SECRET_ENCRYPTION_KEY", "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await PATCH(request({ probe_secret_key: "sk_live_1" }) as any);
        const body = (await res.json()) as { error?: string; code?: string };

        expect(res.status).toBe(500);
        expect(body.code).toBe("secret_key_missing");
        expect(body.error).toMatch(/SECRET_ENCRYPTION_KEY/);
    });

    it("writes nothing at all, rather than some of the keys", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SECRET_ENCRYPTION_KEY", "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await PATCH(request({ site_name: "Blysis", probe_secret_key: "sk_live_1" }) as any);
        expect(transaction).not.toHaveBeenCalled();
    });

    it("saves the settings beside it when no credential is in the body", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SECRET_ENCRYPTION_KEY", "");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await PATCH(request({ site_name: "Blysis" }) as any);
        expect(res.status).toBe(200);
        expect(transaction).toHaveBeenCalled();
    });
});
