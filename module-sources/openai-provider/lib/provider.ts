import OpenAI from "openai";
import { AiError, readSettingValues, type AiProvider, type AiRequest, type AiResult, type AiTier } from "@/core/sdk/server";
import { OPENAI_DEFAULTS, OPENAI_EFFORTS } from "./defaults";
import { responseFormat } from "./schema";

/**
 * OpenAI, through Chat Completions.
 *
 * Core has already chosen the model, wrapped what members wrote and set the
 * deadline; this turns that into one request and the reply into core's result.
 *
 * The address is the SDK's: `api.openai.com`, or `OPENAI_BASE_URL` when the
 * process environment sets one, which is how tests and local development
 * point it at a stand-in. No screen can change it, so no admin can make the
 * server send its key somewhere else.
 *
 * The SDK's own retries are off. Core counted one request against the
 * operator's per-minute limit and holds the deadline; a retry here would be a
 * second spend nobody counted.
 */
const KEYS = {
    apiKey: "openai_api_key",
    modelFast: "openai_model_fast",
    modelSmart: "openai_model_smart",
    effort: "openai_effort",
} as const;

type Effort = (typeof OPENAI_EFFORTS)[number];

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
        modelFast: text(values[KEYS.modelFast]) || OPENAI_DEFAULTS.modelFast,
        modelSmart: text(values[KEYS.modelSmart]) || OPENAI_DEFAULTS.modelSmart,
        effort: typeof effort === "string" && (OPENAI_EFFORTS as readonly string[]).includes(effort)
            ? (effort as Effort)
            : OPENAI_DEFAULTS.effort,
    };
}

function client(apiKey: string): OpenAI {
    // The key is passed, never left to the SDK to find in OPENAI_API_KEY,
    // which would answer for a site whose operator never entered one.
    return new OpenAI({ apiKey, maxRetries: 0 });
}

/**
 * A failure as core can act on it. Only the status and OpenAI's error type
 * survive: the message is OpenAI's sentence, and OpenAI's sentence for a bad
 * key quotes the key.
 */
function failure(err: unknown): Error {
    if (err instanceof AiError) return err;
    if (err instanceof OpenAI.RateLimitError) return new AiError("rate_limited", "openai 429");
    if (err instanceof OpenAI.APIError) {
        return new Error(`openai ${err.status ?? "no status"}${typeof err.type === "string" ? ` ${err.type}` : ""}`);
    }
    return new Error("openai request failed");
}

async function generate(req: AiRequest): Promise<AiResult> {
    const config = await readConfig();
    if (!config.apiKey) throw new AiError("no_provider", "no OpenAI key is stored");

    let reply: OpenAI.ChatCompletion;
    try {
        reply = await client(config.apiKey).chat.completions.create(
            {
                model: req.model,
                max_completion_tokens: req.maxOutputTokens,
                messages: [
                    { role: "system", content: req.system },
                    ...req.messages.map((m) => ({ role: m.role, content: m.text })),
                ],
                response_format: responseFormat(req.schema),
                ...(config.effort === "auto" ? {} : { reasoning_effort: config.effort }),
            },
            { signal: req.signal },
        );
    } catch (err) {
        throw failure(err);
    }

    const choice = reply.choices[0];
    // A refusal, a cut-off or a filtered reply may still hold text, and that
    // text may even parse. It is not the answer either way.
    if (!choice || choice.message.refusal) throw new AiError("invalid_output", "the model declined");
    if (choice.finish_reason === "length") throw new AiError("invalid_output", "the answer was cut off");
    if (choice.finish_reason === "content_filter") throw new AiError("invalid_output", "a content filter stopped the answer");

    let output: unknown;
    try {
        output = JSON.parse(choice.message.content ?? "");
    } catch {
        throw new AiError("invalid_output", "the answer was not JSON");
    }

    return {
        output,
        // OpenAI's prompt count already holds the cached part.
        usage: {
            inputTokens: reply.usage?.prompt_tokens ?? 0,
            outputTokens: reply.usage?.completion_tokens ?? 0,
            cachedInputTokens: reply.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
        model: reply.model,
    };
}

export type ConnectionProblem = "not_configured" | "unauthorized" | "unreachable" | "rate_limited" | "failed";

/**
 * Whether the stored key works, found by listing models: it proves the key
 * and spends no tokens. A problem is named by kind for the screen to
 * translate; OpenAI's own sentence stays here.
 */
export async function tryConnection(): Promise<{ ok: true; models: string[] } | { ok: false; problem: ConnectionProblem }> {
    const config = await readConfig();
    if (!config.apiKey) return { ok: false, problem: "not_configured" };
    try {
        const ids: string[] = [];
        for await (const model of client(config.apiKey).models.list()) ids.push(model.id);
        return { ok: true, models: ids };
    } catch (err) {
        if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
            return { ok: false, problem: "unauthorized" };
        }
        if (err instanceof OpenAI.RateLimitError) return { ok: false, problem: "rate_limited" };
        if (err instanceof OpenAI.APIConnectionError) return { ok: false, problem: "unreachable" };
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
