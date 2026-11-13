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
import { ModuleAiProviders } from "@/core/generated/module-data";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { readSettingValues } from "@/core/lib/setting-values";
import { errorText, log } from "@/core/lib/logger";
import { rateLimit } from "@/core/lib/rate-limit";
import { ENVELOPE_RULE, envelope, type UntrustedText } from "@/core/lib/ai-envelope";
import { AI_SETTING_KEYS, aiSettingsFrom } from "@/core/lib/ai-settings";
import { recordUsage, withinBudget, type UsageRecord } from "@/core/lib/ai-usage";
import { ACTIVE_AI_PROVIDER_KEY } from "@/core/lib/ai-key";

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
    /** `inputTokens` counts every input token; `cachedInputTokens` is the part read from a cache. */
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
        return await readSettingValues([ACTIVE_AI_PROVIDER_KEY, ...Object.values(AI_SETTING_KEYS)]);
    } catch (err) {
        log.warn("[ai] settings could not be read", { error: errorText(err) });
        return {};
    }
}

function chosenIn(values: Record<string, unknown>): string | null {
    const raw = values[ACTIVE_AI_PROVIDER_KEY];
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * A choice naming an installed provider is final: switched off, it means
 * nobody answers, never the other one, which would send members' words to a
 * vendor the operator chose against. A choice naming a provider no longer
 * installed is no choice at all.
 */
function pick(usable: string[], chosen: string | null): string | null {
    if (chosen && chosen in AiProviderRegistry) return usable.includes(chosen) ? chosen : null;
    return usable.length === 1 ? usable[0] : null;
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

export interface AiProviderStatus {
    id: string;
    name: string;
    enabled: boolean;
    configured: boolean;
}

/** Every installed provider and whether it could answer, for the AI screen. */
export async function aiProviderStatus(): Promise<AiProviderStatus[]> {
    const usable = new Set(await installedIds());
    return Promise.all(
        ModuleAiProviders.map(async ({ id, name }) => {
            const enabled = usable.has(id);
            return { id, name, enabled, configured: enabled && (await load(id)) !== null };
        }),
    );
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
    const limits = aiSettingsFrom(values);
    const id = pick(await installedIds(), chosenIn(values));
    const provider = id ? await load(id) : null;

    const usage: UsageRecord = {
        module: opts.module,
        purpose: opts.purpose,
        provider: provider ? id : null,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        outcome: "ok",
        durationMs: 0,
    };
    const refuse = async (kind: AiErrorKind, message?: string): Promise<never> => {
        await recordUsage({ ...usage, outcome: kind });
        throw new AiError(kind, message);
    };

    if (!id || !provider) return refuse("no_provider");
    if (!(await withinBudget(opts.module, limits))) return refuse("budget_exhausted");
    if (limits.requestsPerMinute > 0) {
        // One budget for the site: what costs the operator is the total.
        const { success } = await rateLimit("ai:requests", { maxRequests: limits.requestsPerMinute, windowMs: 60_000 });
        if (!success) return refuse("rate_limited");
    }

    const started = Date.now();
    let result: AiResult;
    try {
        usage.model = opts.model?.trim() || (await provider.defaultModel(opts.tier ?? "fast"));
        const model = usage.model;
        const schema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
        result = await withTimeout(limits.timeoutSeconds, (signal) =>
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
        usage.durationMs = Date.now() - started;
        if (err instanceof AiError) return refuse(err.kind, err.message);
        log.warn("[ai] the provider failed", { provider: id, module: opts.module, purpose: opts.purpose, error: errorText(err) });
        return refuse("provider_error", errorText(err));
    }

    usage.durationMs = Date.now() - started;
    usage.model = result.model || usage.model;
    usage.inputTokens = tokenCount(result.usage?.inputTokens);
    usage.outputTokens = tokenCount(result.usage?.outputTokens);
    usage.cachedInputTokens = tokenCount(result.usage?.cachedInputTokens);

    const parsed = opts.schema.safeParse(result.output);
    if (!parsed.success) {
        log.warn("[ai] the answer did not fit the shape asked for", {
            provider: id,
            module: opts.module,
            purpose: opts.purpose,
            issues: parsed.error.issues.length,
        });
        return refuse("invalid_output");
    }
    await recordUsage(usage);
    return parsed.data;
}

/** A provider's count as a whole number the usage table can hold. */
function tokenCount(raw: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.min(2_000_000_000, Math.round(n)) : 0;
}
