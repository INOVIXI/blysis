import OpenAI from "openai";
import {
    AiError,
    readSettingValues,
    resolveAppName,
    resolveAppUrl,
    type AiProvider,
    type AiRequest,
    type AiResult,
    type AiTier,
} from "@/core/sdk/server";
import { OPENROUTER_DEFAULTS, OPENROUTER_EFFORTS } from "./defaults";
import { responseFormat } from "./schema";

/**
 * Any model OpenRouter offers, through its OpenAI-compatible Chat Completions.
 *
 * Core has already chosen the model, wrapped what members wrote and set the
 * deadline; this turns that into one request and the reply into core's result.
 *
 * The address is OpenRouter's, or `OPENROUTER_BASE_URL` when the process
 * environment sets one, which is how tests and local development point it at
 * a stand-in. It is passed explicitly so `OPENAI_BASE_URL`, meant for the
 * OpenAI provider, never redirects this one. No screen can change it.
 *
 * The SDK's own retries are off: core counted one request against the
 * operator's per-minute limit, and a retry would be a spend nobody counted.
 */
const OPENROUTER_API = "https://openrouter.ai/api/v1";

const KEYS = {
    apiKey: "openrouter_api_key",
    modelFast: "openrouter_model_fast",
    modelSmart: "openrouter_model_smart",
    effort: "openrouter_effort",
    title: "openrouter_app_title",
    siteName: "site_name",
} as const;

type Effort = (typeof OPENROUTER_EFFORTS)[number];

interface Config {
    apiKey: string | null;
    modelFast: string;
    modelSmart: string;
    effort: Effort;
    title: string;
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

async function readConfig(): Promise<Config> {
    const values = await readSettingValues(Object.values(KEYS));
    const effort = values[KEYS.effort];
    return {
        apiKey: text(values[KEYS.apiKey]) || null,
        modelFast: text(values[KEYS.modelFast]) || OPENROUTER_DEFAULTS.modelFast,
        modelSmart: text(values[KEYS.modelSmart]) || OPENROUTER_DEFAULTS.modelSmart,
        effort: typeof effort === "string" && (OPENROUTER_EFFORTS as readonly string[]).includes(effort)
            ? (effort as Effort)
            : OPENROUTER_DEFAULTS.effort,
        title: text(values[KEYS.title]) || text(values[KEYS.siteName]) || resolveAppName(),
    };
}

function client(config: Config & { apiKey: string }): OpenAI {
    return new OpenAI({
        apiKey: config.apiKey,
        baseURL: process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_API,
        maxRetries: 0,
        // How OpenRouter attributes a request to the app that sent it.
        defaultHeaders: { "HTTP-Referer": resolveAppUrl(), "X-Title": config.title },
    });
}

function withKey(config: Config): (Config & { apiKey: string }) | null {
    return config.apiKey ? { ...config, apiKey: config.apiKey } : null;
}

/**
 * A failure as core can act on it. Only the status survives: the message is
 * OpenRouter's sentence, or the upstream host's, and either may quote the key.
 */
function failure(err: unknown): Error {
    if (err instanceof AiError) return err;
    if (err instanceof OpenAI.RateLimitError) return new AiError("rate_limited", "openrouter 429");
    if (err instanceof OpenAI.APIError) return new Error(`openrouter ${err.status ?? "no status"}`);
    return new Error("openrouter request failed");
}

/** What OpenRouter takes beyond OpenAI's parameters. */
interface OpenRouterExtras {
    /** Route only to hosts that support every parameter sent, the schema above all. */
    provider: { require_parameters: true };
    reasoning?: { effort: Exclude<Effort, "auto"> };
}

async function generate(req: AiRequest): Promise<AiResult> {
    const config = withKey(await readConfig());
    if (!config) throw new AiError("no_provider", "no OpenRouter key is stored");

    const body: OpenAI.ChatCompletionCreateParamsNonStreaming & OpenRouterExtras = {
        model: req.model,
        max_completion_tokens: req.maxOutputTokens,
        messages: [
            { role: "system", content: req.system },
            ...req.messages.map((m) => ({ role: m.role, content: m.text })),
        ],
        response_format: responseFormat(req.schema),
        provider: { require_parameters: true },
        ...(config.effort === "auto" ? {} : { reasoning: { effort: config.effort } }),
    };

    let reply: OpenAI.ChatCompletion;
    try {
        reply = await client(config).chat.completions.create(body, { signal: req.signal });
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
        // OpenAI's convention, which OpenRouter keeps: the prompt count holds the cached part.
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
 * Whether the stored key works, and the models to offer.
 *
 * OpenRouter's model list answers without a key, so it proves nothing about
 * one; `/key` describes the key it was called with and refuses a bad one.
 * Neither spends tokens.
 */
export async function tryConnection(): Promise<{ ok: true; models: string[] } | { ok: false; problem: ConnectionProblem }> {
    const config = withKey(await readConfig());
    if (!config) return { ok: false, problem: "not_configured" };
    const api = client(config);
    try {
        await api.get("/key");
        const ids: string[] = [];
        for await (const model of api.models.list()) ids.push(model.id);
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
