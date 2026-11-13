/**
 * The one way a module asks an AI model for something.
 *
 * A provider is a module, declared the way a mail transport is: the manifest
 * names a handler under `aiProvider`, the generator collects them, and core
 * resolves the one the operator chose. Core never names a vendor or a model;
 * a model is a string the provider or the operator supplies.
 *
 * ## Why not the hook bus
 *
 * Every listener there is raced against `DEFAULT_HOOK_TIMEOUT_MS`, and a model
 * call routinely takes longer. The timeout here is the operator's setting.
 *
 * ## An answer in the shape asked for, or nothing
 *
 * The caller hands a Zod schema and gets a value of that type, or an `AiError`
 * whose kind says why not. There is no partial answer and no best guess: a
 * moderation module that half-understood a verdict must do nothing, which is
 * what a thrown error makes it do.
 *
 * ## What a member wrote
 *
 * It reaches the provider only inside the envelope in `ai-envelope.ts`, and
 * the system text says what the envelope means.
 */
import { z } from "zod";
import { AiProviderRegistry } from "@/core/generated/module-ai";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { readSettingValues } from "@/core/lib/setting-values";
import { errorText, log } from "@/core/lib/logger";
import { ENVELOPE_RULE, envelope, type UntrustedText } from "@/core/lib/ai-envelope";

export { ACTIVE_AI_PROVIDER_KEY } from "@/core/lib/ai-key";
import { ACTIVE_AI_PROVIDER_KEY } from "@/core/lib/ai-key";

const AI_TIMEOUT_KEY = "ai_timeout_seconds";
const AI_TIMEOUT_DEFAULT_SECONDS = 30;
const AI_TIMEOUT_MIN_SECONDS = 5;
const AI_TIMEOUT_MAX_SECONDS = 120;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export type AiTier = "fast" | "smart";

export type AiErrorKind =
    | "no_provider"
    | "budget_exhausted"
    | "rate_limited"
    | "timeout"
    | "provider_error"
    | "invalid_output";

export class AiError extends Error {
    readonly kind: AiErrorKind;

    constructor(kind: AiErrorKind, message?: string) {
        super(message ?? kind);
        this.name = "AiError";
        this.kind = kind;
    }
}

/** What a provider receives: the envelope already built, the model already chosen. */
export interface AiRequest {
    system: string;
    messages: { role: "user" | "assistant"; text: string }[];
    /** JSON Schema of the answer. The provider asks its model for exactly this. */
    schema: Record<string, unknown>;
    model: string;
    maxOutputTokens: number;
    signal: AbortSignal;
    /** A stable prefix the provider may cache, when its API caches prompts. */
    cacheHint?: string;
}

export interface AiResult {
    /** The parsed answer. A provider returns an object, never the raw text. */
    output: unknown;
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
    model: string;
}

export interface AiProvider {
    /** Whether this provider has what it needs: a key, an endpoint. */
    isConfigured(): Promise<boolean>;
    /** The model this provider uses for a tier, from its own settings. */
    defaultModel(tier: AiTier): Promise<string>;
    /** Throws on failure; an `AiError` it throws keeps its kind. */
    generate(req: AiRequest): Promise<AiResult>;
    listModels?(): Promise<string[]>;
    testConnection?(): Promise<{ ok: boolean; detail?: string }>;
}

export interface GenerateOptions<T> {
    /** The calling module's id, for limits and the usage record. */
    module: string;
    /** What the call is for, as the module's manifest names it. */
    purpose: string;
    tier?: AiTier;
    /** A model the operator chose in the calling module; wins over the tier. */
    model?: string;
    system: string;
    input: { trusted?: string; untrusted: UntrustedText[] };
    schema: z.ZodType<T>;
    maxOutputTokens?: number;
}

/**
 * Providers that could answer, which is not the same as the ones present.
 *
 * Unlike mail, a module state that cannot be read counts as switched off: an
 * operator who turned a provider off must not have members' posts sent to it
 * because the database blinked.
 */
async function installedIds(): Promise<string[]> {
    const registered = Object.keys(AiProviderRegistry).sort();
    if (registered.length === 0) return registered;
    try {
        const states = await getModuleStates();
        return registered.filter((id) => isEnabledIn(states, id));
    } catch (err) {
        log.warn("[ai] module states could not be read", { error: errorText(err) });
        return [];
    }
}

async function settings(): Promise<Record<string, unknown>> {
    try {
        return await readSettingValues([ACTIVE_AI_PROVIDER_KEY, AI_TIMEOUT_KEY]);
    } catch (err) {
        log.warn("[ai] settings could not be read", { error: errorText(err) });
        return {};
    }
}

function chosenIn(values: Record<string, unknown>): string | null {
    const raw = values[ACTIVE_AI_PROVIDER_KEY];
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function timeoutSecondsIn(values: Record<string, unknown>): number {
    const raw = Number(values[AI_TIMEOUT_KEY]);
    if (!Number.isFinite(raw) || raw <= 0) return AI_TIMEOUT_DEFAULT_SECONDS;
    return Math.min(AI_TIMEOUT_MAX_SECONDS, Math.max(AI_TIMEOUT_MIN_SECONDS, Math.round(raw)));
}

function pick(ids: string[], chosen: string | null): string | null {
    if (ids.length === 0) return null;
    if (ids.length === 1) return ids[0];
    return chosen && ids.includes(chosen) ? chosen : null;
}

/**
 * The provider this site asks, or null. One installed needs no choice; two
 * need the operator's, because picking for them would send members' words to
 * a vendor they did not choose.
 */
export async function activeAiProviderId(): Promise<string | null> {
    return pick(await installedIds(), chosenIn(await settings()));
}

async function load(id: string): Promise<AiProvider | null> {
    const loader = AiProviderRegistry[id];
    if (!loader) return null;
    try {
        const provider = (await loader()) as AiProvider | null;
        if (!provider || typeof provider.generate !== "function") {
            log.warn("[ai] the provider loaded as nothing", { provider: id });
            return null;
        }
        if (!(await provider.isConfigured())) return null;
        return provider;
    } catch (err) {
        log.error("[ai] the provider could not be loaded", { provider: id, error: errorText(err) });
        return null;
    }
}

async function withTimeout<R>(seconds: number, run: (signal: AbortSignal) => Promise<R>): Promise<R> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new AiError("timeout", `no answer within ${seconds}s`));
        }, seconds * 1000);
    });
    try {
        // Raced, not only signalled: a provider that ignores the signal must
        // not hold the caller past the operator's limit.
        return await Promise.race([run(controller.signal), expired]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Asks the active provider for an answer of `schema`'s type.
 *
 * Throws `AiError`. A caller treats every kind the same way: it does nothing
 * it would have done with an answer.
 */
export async function generateStructured<T>(opts: GenerateOptions<T>): Promise<T> {
    const values = await settings();
    const id = pick(await installedIds(), chosenIn(values));
    const provider = id ? await load(id) : null;
    if (!id || !provider) throw new AiError("no_provider");

    let result: AiResult;
    try {
        const model = opts.model?.trim() || (await provider.defaultModel(opts.tier ?? "fast"));
        const schema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
        result = await withTimeout(timeoutSecondsIn(values), (signal) =>
            provider.generate({
                system: `${opts.system}\n\n${ENVELOPE_RULE}`,
                messages: [{ role: "user", text: envelope(opts.input.trusted, opts.input.untrusted) }],
                schema,
                model,
                maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
                signal,
            }),
        );
    } catch (err) {
        if (err instanceof AiError) throw err;
        log.warn("[ai] the provider failed", { provider: id, module: opts.module, purpose: opts.purpose, error: errorText(err) });
        throw new AiError("provider_error", errorText(err));
    }

    const parsed = opts.schema.safeParse(result.output);
    if (!parsed.success) {
        log.warn("[ai] the answer did not fit the shape asked for", {
            provider: id,
            module: opts.module,
            purpose: opts.purpose,
            issues: parsed.error.issues.length,
        });
        throw new AiError("invalid_output");
    }
    return parsed.data;
}
