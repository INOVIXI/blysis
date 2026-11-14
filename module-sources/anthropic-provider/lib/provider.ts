import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { AiError, readSettingValues, type AiProvider, type AiRequest, type AiResult, type AiTier } from "@/core/sdk/server";
import { ANTHROPIC_DEFAULTS, ANTHROPIC_EFFORTS } from "./defaults";

/**
 * Claude, through Anthropic's Messages API.
 *
 * Core has already chosen the model, wrapped what members wrote and set the
 * deadline; this turns that into one request and the reply into core's result.
 *
 * The address is the SDK's: `api.anthropic.com`, or `ANTHROPIC_BASE_URL` when
 * the process environment sets one, which is how tests and local development
 * point it at a stand-in. No screen can change it, so no admin can make the
 * server send its key somewhere else.
 *
 * The SDK's own retries are off. Core counted one request against the
 * operator's per-minute limit and holds the deadline; a retry here would be a
 * second spend nobody counted. A caller that wants another try asks again.
 */
const KEYS = {
    apiKey: "anthropic_api_key",
    modelFast: "anthropic_model_fast",
    modelSmart: "anthropic_model_smart",
    effort: "anthropic_effort",
} as const;

type Effort = (typeof ANTHROPIC_EFFORTS)[number];

interface Config {
    apiKey: string | null;
    modelFast: string;
    modelSmart: string;
    effort: Effort;
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

async function readConfig(): Promise<Config> {
    const values = await readSettingValues(Object.values(KEYS));
    const effort = values[KEYS.effort];
    return {
        apiKey: text(values[KEYS.apiKey]) || null,
        modelFast: text(values[KEYS.modelFast]) || ANTHROPIC_DEFAULTS.modelFast,
        modelSmart: text(values[KEYS.modelSmart]) || ANTHROPIC_DEFAULTS.modelSmart,
        effort: typeof effort === "string" && (ANTHROPIC_EFFORTS as readonly string[]).includes(effort)
            ? (effort as Effort)
            : ANTHROPIC_DEFAULTS.effort,
    };
}

function client(apiKey: string): Anthropic {
    // The key is passed, never left to the SDK to find: its own search reads
    // ANTHROPIC_API_KEY and login profiles on the server, which would answer
    // for a site whose operator never entered a key.
    return new Anthropic({ apiKey, maxRetries: 0 });
}

/**
 * A failure as core can act on it. Only the status and Anthropic's error type
 * survive: the message is Anthropic's sentence, and a sentence is where a
 * credential could be echoed back into a log.
 */
function failure(err: unknown): Error {
    if (err instanceof AiError) return err;
    if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limited", "anthropic 429");
    if (err instanceof Anthropic.APIError) {
        const type = (err.error as { error?: { type?: unknown } } | undefined)?.error?.type;
        return new Error(`anthropic ${err.status ?? "no status"}${typeof type === "string" ? ` ${type}` : ""}`);
    }
    return new Error("anthropic request failed");
}

async function generate(req: AiRequest): Promise<AiResult> {
    const config = await readConfig();
    if (!config.apiKey) throw new AiError("no_provider", "no Anthropic key is stored");

    let reply: Anthropic.Message;
    try {
        reply = await client(config.apiKey).messages.create(
            {
                model: req.model,
                max_tokens: req.maxOutputTokens,
                // Marked for caching: the same instructions open every call a
                // module makes for one purpose. Below the model's minimum
                // length it simply is not cached, at no cost.
                system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
                messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
                output_config: {
                    format: { type: "json_schema", schema: transformJSONSchema(req.schema) },
                    ...(config.effort === "auto" ? {} : { effort: config.effort }),
                },
            },
            { signal: req.signal },
        );
    } catch (err) {
        throw failure(err);
    }

    // A decline or a reply cut off at the limit may still hold text, and that
    // text may even parse. It is not the answer either way.
    if (reply.stop_reason === "refusal") throw new AiError("invalid_output", "Claude declined");
    if (reply.stop_reason === "max_tokens") throw new AiError("invalid_output", "the answer was cut off");

    const body = reply.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let output: unknown;
    try {
        output = JSON.parse(body);
    } catch {
        throw new AiError("invalid_output", "the answer was not JSON");
    }

    const cacheRead = reply.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = reply.usage.cache_creation_input_tokens ?? 0;
    return {
        output,
        // Anthropic counts cached and uncached input apart; core's contract
        // is every input token, with the cached part named.
        usage: {
            inputTokens: reply.usage.input_tokens + cacheRead + cacheWrite,
            outputTokens: reply.usage.output_tokens,
            cachedInputTokens: cacheRead,
        },
        model: reply.model,
    };
}

/** Every model this key may use, every page of them. */
async function modelIds(apiKey: string): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of client(apiKey).models.list()) ids.push(model.id);
    return ids;
}

export type ConnectionProblem = "not_configured" | "unauthorized" | "unreachable" | "rate_limited" | "failed";

/**
 * Whether the stored key works, found by listing models: it proves the key
 * and spends no tokens. A problem is named by kind for the screen to
 * translate; Anthropic's own sentence stays here.
 */
export async function tryConnection(): Promise<{ ok: true; models: string[] } | { ok: false; problem: ConnectionProblem }> {
    const config = await readConfig();
    if (!config.apiKey) return { ok: false, problem: "not_configured" };
    try {
        return { ok: true, models: await modelIds(config.apiKey) };
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
            return { ok: false, problem: "unauthorized" };
        }
        if (err instanceof Anthropic.RateLimitError) return { ok: false, problem: "rate_limited" };
        if (err instanceof Anthropic.APIConnectionError) return { ok: false, problem: "unreachable" };
        return { ok: false, problem: "failed" };
    }
}

const provider: AiProvider = {
    async isConfigured() {
        return (await readConfig()).apiKey !== null;
    },
    async defaultModel(tier: AiTier) {
        const config = await readConfig();
        return tier === "smart" ? config.modelSmart : config.modelFast;
    },
    generate,
};

export default provider;
