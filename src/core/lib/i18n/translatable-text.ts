import { locales } from "./config";

/**
 * Text an operator typed, with a translation per language beside it.
 *
 * A site name, a navbar label or a hero heading had one value, shown in every
 * language, so a Turkish site with English readers showed Turkish to everyone.
 * The value is now either what it always was, a string that reads the same in
 * every language, or an object holding the original text under `default` and a
 * translation under each language code the operator filled in.
 *
 * One value at the same key, rather than a second `..._i18n` key beside it,
 * because the value travels through pipes that know only the key: the public
 * settings allowlist and its size limits, a theme setting a block refers to,
 * the navbar's own JSON. A sibling key would have to be taught to each of them
 * and kept in step on every write; an object at the key is stored, cached and
 * served as the string was. Every row written before this is a string, and a
 * string still means "every language", so nothing has to be migrated.
 *
 * `default` is the text the operator typed first, in whatever language they
 * typed it. It is not the site's default language's entry, and the resolver
 * never looks that entry up: a reader whose language has no translation reads
 * the original, which is the owner's rule and the one the editor promises.
 * `operator-text-is-read-in-the-readers-language` holds it.
 */
export type TranslatableText = string | TranslatedText;

export interface TranslatedText {
    /** The original text, typed first and shown wherever no translation is. */
    default: string;
    [locale: string]: string;
}

const KNOWN: ReadonlySet<string> = new Set(locales);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string, or an object with an original text and nothing but strings beside it. */
export function isTranslatableText(value: unknown): value is TranslatableText {
    if (typeof value === "string") return true;
    if (!isRecord(value) || typeof value.default !== "string") return false;
    return Object.values(value).every((entry) => typeof entry === "string");
}

/** The text as the operator typed it first, for a reader with no language. */
export function originalText(value: unknown): string {
    if (typeof value === "string") return value;
    return isRecord(value) && typeof value.default === "string" ? value.default : "";
}

/**
 * The text for a reader of `locale`: their own translation when it holds
 * anything but blanks, otherwise the original.
 *
 * Pure and synchronous, with no reading of the site's languages, so the server
 * and the browser given the same value and locale draw the same string and a
 * page cannot hydrate into a different word.
 */
export function textFor(value: unknown, locale: string): string {
    if (typeof value === "string") return value;
    // An object with no original is not a value this shape describes, and a
    // stray entry in it is not something an operator chose to show.
    if (!isRecord(value) || typeof value.default !== "string") return "";
    if (KNOWN.has(locale) && Object.prototype.hasOwnProperty.call(value, locale)) {
        const own = value[locale];
        if (typeof own === "string" && own.trim().length > 0) return own;
    }
    return originalText(value);
}

/**
 * The value as it may be stored, or `undefined` when it is not text: each
 * text cut to `max`, languages the software does not ship dropped, blank
 * translations dropped, and a value left with no translation stored as the
 * plain string it then is.
 */
export function cleanTranslatableText(value: unknown, max: number): TranslatableText | undefined {
    if (typeof value === "string") return value.slice(0, max);
    if (!isTranslatableText(value) || typeof value === "string") return undefined;
    const out: TranslatedText = { default: value.default.slice(0, max) };
    for (const locale of locales) {
        if (!Object.prototype.hasOwnProperty.call(value, locale)) continue;
        const entry = value[locale];
        if (entry.trim().length > 0) out[locale] = entry.slice(0, max);
    }
    return Object.keys(out).length === 1 ? out.default : out;
}

/** The longest single text in the value, which is what a per-key limit measures. */
export function longestText(value: TranslatableText): number {
    if (typeof value === "string") return value.length;
    return Math.max(...Object.values(value).map((entry) => entry.length));
}
