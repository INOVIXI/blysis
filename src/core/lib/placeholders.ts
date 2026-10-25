import { cached } from "@/core/lib/cache";
import { CORE_PLACEHOLDERS } from "@/core/lib/core-placeholders";
import { log, errorText } from "@/core/lib/logger";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import type { PlaceholderValue } from "@/core/lib/placeholder-text";
import { ModulePlaceholders } from "@/core/generated/module-placeholders";

/**
 * The site placeholders this install answers, and their values.
 *
 * Asked on every page, so none of them may hold one up or take it down. Each
 * goes through the cache for as long as its module says its value keeps, and
 * is raced against the time the caller can spare: one that is not ready is
 * reported pending, for the browser to ask the endpoint again, and keeps
 * running to fill the cache for the next page. One that throws answers null,
 * for itself alone. Server only.
 */

/** One placeholder as the registry lists it: core's and every module's. */
export interface PlaceholderSource {
    /** The full name, `<namespace>.<name>`. */
    name: string;
    /** The module that answers it, or `core`. */
    module: string;
    /** Under `admin` in the module's translations, or core's. */
    labelKey: string;
    example: string | null;
    maxAgeSeconds: number;
    loader: () => Promise<{ default: () => Promise<unknown> }>;
}

export interface ResolvedPlaceholders {
    values: Record<string, PlaceholderValue>;
    /** Asked and not answered in time: the browser asks the endpoint for these. */
    pending: string[];
}

/** Longer and it is a sentence, not a value to drop into one. */
const MAX_TEXT = 200;

/** A value as a page may show it: a finite number or plain text, else none. */
function placeholderValue(raw: unknown): PlaceholderValue {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw === "string") {
        const text = raw.trim().slice(0, MAX_TEXT);
        return text === "" ? null : text;
    }
    return null;
}

/** Core's and every enabled module's placeholders. */
export async function placeholderSources(): Promise<PlaceholderSource[]> {
    const states = await getModuleStates();
    return [...CORE_PLACEHOLDERS, ...ModulePlaceholders.filter((source) => isEnabledIn(states, source.module))];
}

/** Said once per process: a broken handler would otherwise log every page. */
const reported = new Set<string>();

async function ask(source: PlaceholderSource): Promise<PlaceholderValue> {
    // Wrapped, because the cache keeps no null and "no value" is an answer:
    // a site with no game server would otherwise ask why on every page.
    const kept = await cached(`placeholder:${source.name}`, source.maxAgeSeconds * 1000, async () => {
        try {
            const { default: handler } = await source.loader();
            return { value: placeholderValue(await handler()) };
        } catch (err) {
            if (!reported.has(source.name)) {
                reported.add(source.name);
                log.warn("placeholder_failed", { placeholder: source.name, error: errorText(err) });
            }
            return { value: null };
        }
    });
    return kept.value;
}

const NOT_YET = Symbol("not yet");

/** Every enabled placeholder's value, as far as `budgetMs` allows. */
export async function resolvePlaceholders(options: { budgetMs: number }): Promise<ResolvedPlaceholders> {
    const sources = await placeholderSources();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof NOT_YET>((resolve) => {
        timer = setTimeout(() => resolve(NOT_YET), options.budgetMs);
    });
    const answers = await Promise.all(sources.map((source) => Promise.race([ask(source), deadline])));
    clearTimeout(timer);

    const values: Record<string, PlaceholderValue> = {};
    const pending: string[] = [];
    sources.forEach((source, i) => {
        const answer = answers[i];
        if (answer === NOT_YET) pending.push(source.name);
        else values[source.name] = answer;
    });
    return { values, pending };
}
