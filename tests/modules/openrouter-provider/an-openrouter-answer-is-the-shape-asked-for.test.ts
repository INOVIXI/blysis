// @vitest-environment node
/**
 * The OpenRouter provider speaks OpenAI's Chat Completions to OpenRouter.
 *
 * What differs from OpenAI is what OpenRouter needs to route well: the site's
 * address and name in its own headers, an instruction to route only to hosts
 * that honour the answer's schema (otherwise a host that ignores
 * `response_format` answers in prose), and its own shape for reasoning effort.
 * Trying a key asks OpenRouter about the key itself, since its model list
 * answers without one and would call any key good.
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
vi.mock("@/core/sdk/server", () => ({
    AiError,
    readSettingValues: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]])),
    resolveAppUrl: () => "https://play.example",
    resolveAppName: () => "Blysis",
}));

const KEY = "sk-or-v1-test-0123456789";
const sent: { url: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
let reply: (url: string) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function completion(content: string | null, finish_reason = "stop") {
    return json({
        id: "gen-1",
        object: "chat.completion",
        created: 1,
        model: "openai/gpt-6-luna",
        choices: [{ index: 0, finish_reason, message: { role: "assistant", content, refusal: null } }],
        usage: { prompt_tokens: 300, completion_tokens: 12, total_tokens: 312, prompt_tokens_details: { cached_tokens: 0 } },
    });
}

const { default: provider, tryConnection } = await import("@/modules/openrouter-provider/lib/provider");

function request(extra: Record<string, unknown> = {}) {
    return {
        system: "Decide whether the post follows the rules.",
        messages: [{ role: "user" as const, text: '<untrusted label="post">hello</untrusted>' }],
        schema: { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"], additionalProperties: false },
        model: "openai/gpt-6-luna",
        maxOutputTokens: 1024,
        signal: new AbortController().signal,
        ...extra,
    };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return "resolved";
    } catch (err) {
        return err instanceof AiError ? err.kind : `plain: ${(err as Error).message}`;
    }
}

beforeEach(() => {
    settings = { openrouter_api_key: KEY, site_name: "Kayadibi" };
    sent.length = 0;
    reply = () => completion('{"verdict":"approve"}');
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        sent.push({ url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
        return reply(url);
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the model for a tier", () => {
    it("is the shipped default until the operator picks one", async () => {
        expect(await provider.defaultModel("fast")).toBe("openai/gpt-6-luna");
        expect(await provider.defaultModel("smart")).toBe("openai/gpt-6.1-sol");
    });

    it("is the operator's choice once they made one", async () => {
        settings.openrouter_model_smart = "anthropic/claude-sonnet-5.5";
        expect(await provider.defaultModel("smart")).toBe("anthropic/claude-sonnet-5.5");
    });
});

describe("the request", () => {
    it("goes to OpenRouter with the operator's key", async () => {
        await provider.generate(request());
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(sent[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    });

    it("names the site by its address and its name", async () => {
        await provider.generate(request());
        expect(sent[0].headers.get("http-referer")).toBe("https://play.example");
        expect(sent[0].headers.get("x-title")).toBe("Kayadibi");
    });

    it("names the site the way the operator chose, when they did", async () => {
        settings.openrouter_app_title = "Kayadibi Network";
        await provider.generate(request());
        expect(sent[0].headers.get("x-title")).toBe("Kayadibi Network");
    });

    it("carries none of the OpenAI account the server environment may name", async () => {
        vi.stubEnv("OPENAI_ORG_ID", "org-operator");
        vi.stubEnv("OPENAI_PROJECT_ID", "proj-operator");
        try {
            await provider.generate(request());
        } finally {
            vi.unstubAllEnvs();
        }
        expect(sent[0].headers.get("openai-organization")).toBeNull();
        expect(sent[0].headers.get("openai-project")).toBeNull();
    });

    it("routes only to hosts that honour the schema", async () => {
        await provider.generate(request());
        expect(sent[0].body).toMatchObject({
            provider: { require_parameters: true },
            response_format: { type: "json_schema", json_schema: { strict: true } },
        });
    });

    it("sends reasoning effort in OpenRouter's shape, and only when chosen", async () => {
        await provider.generate(request());
        expect(sent[0].body).not.toHaveProperty("reasoning");
        settings.openrouter_effort = "low";
        await provider.generate(request());
        expect(sent[1].body!.reasoning).toEqual({ effort: "low" });
    });

    it("is sent once: core's limits counted one request", async () => {
        reply = () => json({ error: { message: "upstream", code: 502 } }, 502);
        await kindOf(provider.generate(request()));
        expect(sent).toHaveLength(1);
    });
});

describe("the answer", () => {
    it("is the parsed object with OpenRouter's counts", async () => {
        expect(await provider.generate(request())).toEqual({
            output: { verdict: "approve" },
            usage: { inputTokens: 300, outputTokens: 12, cachedInputTokens: 0 },
            model: "openai/gpt-6-luna",
        });
    });

    it("is none when it was cut off at the token limit", async () => {
        reply = () => completion('{"verdict":"appr', "length");
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });

    it("is none when the text is not JSON", async () => {
        reply = () => completion("approve");
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });
});

describe("a failure", () => {
    it("is a rate limit core can name when OpenRouter answers 429", async () => {
        reply = () => json({ error: { message: "slow down", code: 429 } }, 429);
        expect(await kindOf(provider.generate(request()))).toBe("rate_limited");
    });

    it("never carries the key in its message", async () => {
        reply = () => json({ error: { message: `No auth credentials found for ${KEY}`, code: 401 } }, 401);
        const outcome = await kindOf(provider.generate(request()));
        expect(outcome).toContain("401");
        expect(outcome).not.toContain(KEY);
    });
});

describe("trying the stored key", () => {
    it("asks about the key, then lists the models", async () => {
        reply = (url) =>
            url.endsWith("/key")
                ? json({ data: { label: "sk-or-v1-...", usage: 0, limit: null } })
                : json({ data: [{ id: "openai/gpt-6-luna" }, { id: "anthropic/claude-haiku-5.5" }] });
        expect(await tryConnection()).toEqual({ ok: true, models: ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"] });
        expect(sent.map((s) => s.url)).toEqual(["https://openrouter.ai/api/v1/key", "https://openrouter.ai/api/v1/models"]);
        expect(sent[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    });

    it("calls a key OpenRouter refuses refused, whatever the model list says", async () => {
        reply = (url) => (url.endsWith("/key") ? json({ error: { message: "bad key", code: 401 } }, 401) : json({ data: [] }));
        expect(await tryConnection()).toEqual({ ok: false, problem: "unauthorized" });
    });

    it("says there is nothing to try before a key is saved", async () => {
        settings = {};
        expect(await tryConnection()).toEqual({ ok: false, problem: "not_configured" });
        expect(sent).toEqual([]);
    });
});
