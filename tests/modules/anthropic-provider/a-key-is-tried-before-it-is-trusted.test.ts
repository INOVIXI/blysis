// @vitest-environment node
/**
 * An operator who pasted a key needs to know it works before a member's post
 * waits on it. Trying it lists the models the key may use, which spends no
 * tokens and fills the model fields' suggestions in the same step.
 *
 * The answer names the kind of problem, never Anthropic's sentence: that is
 * the screen's to translate, and a vendor's sentence is where a key could be
 * echoed back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class AiError extends Error {
    readonly kind: string;
    constructor(kind: string, message?: string) {
        super(message ?? kind);
        this.kind = kind;
    }
}

let settings: Record<string, unknown> = {};
const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin-1" } } };
let admin = true;
vi.mock("@/core/sdk/server", () => ({
    AiError,
    isAdmin: async () => admin,
    readSettingValues: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]])),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

let reply: () => Response | Promise<Response>;
const fetchMock = vi.fn(async () => reply());

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const { POST } = await import("@/modules/anthropic-provider/api/admin/connection/route");

async function tryIt() {
    const res = await POST();
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
    settings = { anthropic_api_key: "sk-ant-test" };
    session.value = { user: { id: "admin-1" } };
    admin = true;
    reply = () => json({ data: [{ id: "claude-haiku-5-5", type: "model" }], has_more: false });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("trying the stored key", () => {
    it("is refused without a session", async () => {
        session.value = null;
        expect((await tryIt()).status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is refused to someone who is not an admin", async () => {
        admin = false;
        expect((await tryIt()).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("says there is nothing to try before a key is saved", async () => {
        settings = {};
        expect(await tryIt()).toEqual({ status: 400, body: expect.objectContaining({ code: "not_configured" }) });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers with the models the key may use", async () => {
        expect(await tryIt()).toEqual({ status: 200, body: { ok: true, models: ["claude-haiku-5-5"] } });
    });

    it("says the key was refused", async () => {
        reply = () => json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
        expect(await tryIt()).toEqual({ status: 502, body: expect.objectContaining({ code: "unauthorized" }) });
    });

    it("says Anthropic could not be reached", async () => {
        reply = () => Promise.reject(new TypeError("fetch failed"));
        expect(await tryIt()).toEqual({ status: 502, body: expect.objectContaining({ code: "unreachable" }) });
    });

    it("says Anthropic is asking it to slow down", async () => {
        reply = () => json({ type: "error", error: { type: "rate_limit_error", message: "slow" } }, 429);
        expect(await tryIt()).toEqual({ status: 502, body: expect.objectContaining({ code: "rate_limited" }) });
    });
});
