// @vitest-environment node
/**
 * The OpenAI provider turns core's request into one Chat Completions call and
 * the reply back into core's result.
 *
 * The answer is bound to the schema through `response_format`, strictly when
 * the schema meets OpenAI's strict rules and as guidance when it does not,
 * since a strict request with a schema that breaks them is refused outright.
 * A refusal or a reply cut off at the limit is no answer, a 429 is a rate
 * limit core can name, and the key never reaches an error message.
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
}));

const KEY = "sk-proj-test-0123456789";
const sent: { url: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
let reply: (url: string) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function completion(content: string | null, extra: { finish_reason?: string; refusal?: string | null } = {}) {
    return json({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-6-luna",
        choices: [{
            index: 0,
            finish_reason: extra.finish_reason ?? "stop",
            message: { role: "assistant", content, refusal: extra.refusal ?? null },
        }],
        usage: { prompt_tokens: 500, completion_tokens: 20, total_tokens: 520, prompt_tokens_details: { cached_tokens: 384 } },
    });
}

const { default: provider, tryConnection } = await import("@/modules/openai-provider/lib/provider");

const STRICT_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { verdict: { type: "string", enum: ["approve", "reject"] } },
    required: ["verdict"],
    additionalProperties: false,
};

function request(extra: Record<string, unknown> = {}) {
    return {
        system: "Decide whether the post follows the rules.",
        messages: [{ role: "user" as const, text: '<untrusted label="post">hello</untrusted>' }],
        schema: STRICT_SCHEMA,
        model: "gpt-6-luna",
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
    settings = { openai_api_key: KEY };
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

describe("whether OpenAI can answer", () => {
    it("is no until the operator saved a key", async () => {
        settings = {};
        expect(await provider.isConfigured()).toBe(false);
    });

    it("is yes once a key is stored", async () => {
        expect(await provider.isConfigured()).toBe(true);
    });
});

describe("the model for a tier", () => {
    it("is the shipped default until the operator picks one", async () => {
        expect(await provider.defaultModel("fast")).toBe("gpt-6-luna");
        expect(await provider.defaultModel("smart")).toBe("gpt-6.1-sol");
    });

    it("is the operator's choice once they made one", async () => {
        settings.openai_model_fast = "gpt-5.4-mini";
        expect(await provider.defaultModel("fast")).toBe("gpt-5.4-mini");
    });
});

describe("the request", () => {
    it("goes to Chat Completions with the operator's key, the model and the system text first", async () => {
        await provider.generate(request());
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
        expect(sent[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
        expect(sent[0].body).toMatchObject({
            model: "gpt-6-luna",
            max_completion_tokens: 1024,
            messages: [
                { role: "system", content: "Decide whether the post follows the rules." },
                { role: "user", content: '<untrusted label="post">hello</untrusted>' },
            ],
        });
    });

    it("binds the answer strictly when the schema meets the strict rules", async () => {
        await provider.generate(request());
        const format = sent[0].body!.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
        expect(format.type).toBe("json_schema");
        expect(format.json_schema.strict).toBe(true);
        expect(format.json_schema.schema).not.toHaveProperty("$schema");
    });

    it("guides without strict when a property is optional, which strict mode refuses", async () => {
        await provider.generate(request({
            schema: { type: "object", properties: { verdict: { type: "string" }, note: { type: "string" } }, required: ["verdict"], additionalProperties: false },
        }));
        expect((sent[0].body!.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(false);
    });

    it("guides without strict when a nested object allows other keys", async () => {
        await provider.generate(request({
            schema: {
                type: "object",
                properties: { reason: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
                required: ["reason"],
                additionalProperties: false,
            },
        }));
        expect((sent[0].body!.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(false);
    });

    it("sends no reasoning effort until the operator chooses one", async () => {
        await provider.generate(request());
        expect(sent[0].body).not.toHaveProperty("reasoning_effort");
        settings.openai_effort = "low";
        await provider.generate(request());
        expect(sent[1].body!.reasoning_effort).toBe("low");
    });

    it("is sent once: core's limits counted one request", async () => {
        reply = () => json({ error: { message: "busy", type: "server_error" } }, 503);
        await kindOf(provider.generate(request()));
        expect(sent).toHaveLength(1);
    });
});

describe("the answer", () => {
    it("is the parsed object, with every input token counted and the cached part named", async () => {
        const result = await provider.generate(request());
        expect(result).toEqual({
            output: { verdict: "approve" },
            usage: { inputTokens: 500, outputTokens: 20, cachedInputTokens: 384 },
            model: "gpt-6-luna",
        });
    });

    it("is none when the model refused", async () => {
        reply = () => completion(null, { refusal: "I can't help with that." });
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });

    it("is none when it was cut off at the token limit", async () => {
        reply = () => completion('{"verdict":"appr', { finish_reason: "length" });
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });

    it("is none when a content filter stopped it", async () => {
        reply = () => completion("", { finish_reason: "content_filter" });
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });

    it("is none when the text is not JSON", async () => {
        reply = () => completion("Sure! approve.");
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });
});

describe("a failure", () => {
    it("is a rate limit core can name when OpenAI answers 429", async () => {
        reply = () => json({ error: { message: "Rate limit reached", type: "requests" } }, 429);
        expect(await kindOf(provider.generate(request()))).toBe("rate_limited");
    });

    it("never carries the key in its message", async () => {
        reply = () => json({ error: { message: `Incorrect API key provided: ${KEY}`, type: "invalid_request_error" } }, 401);
        const outcome = await kindOf(provider.generate(request()));
        expect(outcome).toContain("401");
        expect(outcome).not.toContain(KEY);
    });

    it("is refused before any request when no key is stored", async () => {
        settings = {};
        expect(await kindOf(provider.generate(request()))).toBe("no_provider");
        expect(sent).toEqual([]);
    });
});

describe("trying the stored key", () => {
    it("lists the models it may use", async () => {
        reply = () => json({ object: "list", data: [{ id: "gpt-6-luna", object: "model" }, { id: "gpt-6.1-sol", object: "model" }] });
        expect(await tryConnection()).toEqual({ ok: true, models: ["gpt-6-luna", "gpt-6.1-sol"] });
        expect(sent[0].url).toBe("https://api.openai.com/v1/models");
    });

    it("says there is nothing to try before a key is saved", async () => {
        settings = {};
        expect(await tryConnection()).toEqual({ ok: false, problem: "not_configured" });
        expect(sent).toEqual([]);
    });

    it("names a refused key, an unreachable server and a rate limit apart", async () => {
        reply = () => json({ error: { message: "bad key", type: "invalid_request_error" } }, 401);
        expect(await tryConnection()).toEqual({ ok: false, problem: "unauthorized" });
        reply = () => Promise.reject(new TypeError("fetch failed"));
        expect(await tryConnection()).toEqual({ ok: false, problem: "unreachable" });
        reply = () => json({ error: { message: "slow", type: "requests" } }, 429);
        expect(await tryConnection()).toEqual({ ok: false, problem: "rate_limited" });
    });
});
