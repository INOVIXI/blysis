// @vitest-environment node
/**
 * The Claude provider turns core's request into one Messages API call and
 * Claude's reply back into core's result, and nothing else.
 *
 * What it must get right is narrow and easy to get wrong: the answer is bound
 * to the schema by the API, not by a polite sentence; the operator's key and
 * models are the ones used; a reply Claude declined or cut short is no answer;
 * a 429 is a rate limit core can name; and the key never ends up in an error
 * message, which is a string that travels to logs.
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

const KEY = "sk-ant-test-0123456789";
const sent: { url: string; method: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
let reply: (url: string) => Response;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function message(text: string, extra: Record<string, unknown> = {}) {
    return json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 },
        ...extra,
    });
}

const { default: provider, tryConnection } = await import("@/modules/anthropic-provider/lib/provider");

const SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { verdict: { type: "string", enum: ["approve", "reject"] }, note: { type: "string", maxLength: 200 } },
    required: ["verdict", "note"],
    additionalProperties: false,
};

function request(extra: Record<string, unknown> = {}) {
    return {
        system: "Decide whether the post follows the rules.",
        messages: [{ role: "user" as const, text: '<untrusted label="post">hello</untrusted>' }],
        schema: SCHEMA,
        model: "claude-haiku-5-5",
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
    settings = { anthropic_api_key: KEY };
    sent.length = 0;
    reply = () => message('{"verdict":"approve","note":"fine"}');
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        sent.push({
            url,
            method: init?.method ?? "GET",
            headers: new Headers(init?.headers),
            body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return reply(url);
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("whether Claude can answer", () => {
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
        expect(await provider.defaultModel("fast")).toBe("claude-haiku-5-5");
        expect(await provider.defaultModel("smart")).toBe("claude-sonnet-5-5");
    });

    it("is the operator's choice once they made one", async () => {
        settings.anthropic_model_smart = "claude-opus-5-5";
        expect(await provider.defaultModel("smart")).toBe("claude-opus-5-5");
    });
});

describe("the request", () => {
    it("goes to the Messages API with the operator's key and the chosen model", async () => {
        await provider.generate(request());
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe("https://api.anthropic.com/v1/messages");
        expect(sent[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
        expect(sent[0].body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1024 });
    });

    it("binds the answer to the schema through the API, without what it cannot take", async () => {
        await provider.generate(request());
        const format = (sent[0].body!.output_config as { format: { type: string; schema: Record<string, unknown> } }).format;
        expect(format.type).toBe("json_schema");
        expect(format.schema).not.toHaveProperty("$schema");
        expect((format.schema.properties as Record<string, Record<string, unknown>>).note).not.toHaveProperty("maxLength");
        expect(JSON.stringify(format.schema)).toContain("approve");
    });

    it("marks the system text for caching, since it repeats call after call", async () => {
        await provider.generate(request());
        expect(sent[0].body!.system).toEqual([
            { type: "text", text: "Decide whether the post follows the rules.", cache_control: { type: "ephemeral" } },
        ]);
        expect(sent[0].body!.messages).toEqual([{ role: "user", content: '<untrusted label="post">hello</untrusted>' }]);
    });

    it("asks for low effort unless the operator chose another", async () => {
        await provider.generate(request());
        expect((sent[0].body!.output_config as { effort?: string }).effort).toBe("low");
        settings.anthropic_effort = "high";
        await provider.generate(request());
        expect((sent[1].body!.output_config as { effort?: string }).effort).toBe("high");
    });

    it("leaves effort to the model when the operator chose auto", async () => {
        settings.anthropic_effort = "auto";
        await provider.generate(request());
        expect(sent[0].body!.output_config).not.toHaveProperty("effort");
    });

    it("is sent once: core's limits counted one request", async () => {
        reply = () => json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529);
        await kindOf(provider.generate(request()));
        expect(sent).toHaveLength(1);
    });
});

describe("the answer", () => {
    it("is the parsed object, with every input token counted and the cached part named", async () => {
        const result = await provider.generate(request());
        expect(result.output).toEqual({ verdict: "approve", note: "fine" });
        expect(result.usage).toEqual({ inputTokens: 550, outputTokens: 20, cachedInputTokens: 400 });
        expect(result.model).toBe("claude-haiku-5-5");
    });

    it("is none when Claude declined", async () => {
        reply = () => message("", { stop_reason: "refusal", content: [] });
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });

    it("is none when it was cut off at the token limit", async () => {
        reply = () => message('{"verdict":"appr', { stop_reason: "max_tokens" });
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });

    it("is none when the text is not JSON", async () => {
        reply = () => message("Sure! approve.");
        expect(await kindOf(provider.generate(request()))).toBe("invalid_output");
    });
});

describe("a failure", () => {
    it("is a rate limit core can name when Anthropic answers 429", async () => {
        reply = () => json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429);
        expect(await kindOf(provider.generate(request()))).toBe("rate_limited");
    });

    it("never carries the key in its message", async () => {
        reply = () => json({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${KEY}` } }, 401);
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

describe("the models Anthropic lists", () => {
    it("are read with the operator's key, every page of them", async () => {
        reply = (url) =>
            url.includes("after_id=m2")
                ? json({ data: [{ id: "m3", type: "model" }], has_more: false, first_id: "m3", last_id: "m3" })
                : json({ data: [{ id: "m1", type: "model" }, { id: "m2", type: "model" }], has_more: true, first_id: "m1", last_id: "m2" });
        expect(await tryConnection()).toEqual({ ok: true, models: ["m1", "m2", "m3"] });
        expect(sent[0].url).toContain("https://api.anthropic.com/v1/models");
        expect(sent[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    });
});
