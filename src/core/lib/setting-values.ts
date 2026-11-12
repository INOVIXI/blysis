/**
 * Reading the site settings store, with credentials opened on the way out.
 *
 * Nineteen modules had written the same eight lines: pull the rows for a list
 * of keys, coerce each value to a trimmed string or null, fall back to an
 * environment variable. That was harmless duplication right up until the
 * values started being encrypted at rest, at which point every one of those
 * copies would have handed its provider a ciphertext and produced the worst
 * class of bug - a gateway rejecting the operator's key, which reads as "the
 * operator pasted it wrong" and is chased in the wrong place for days.
 *
 * So the read is one call. `secret-settings.ts` decides which values are
 * credentials, from what the modules themselves declared; this only knows how
 * to fetch a row and hand it over.
 */
import { prisma } from "@/core/lib/db";
import { settingsFromStorage } from "@/core/lib/secret-settings";
import { isTranslatableText, originalText } from "@/core/lib/i18n/translatable-text";

/**
 * The stored value of each key, as JSON, with any declared credential
 * decrypted. A key with no row is absent from the result.
 */
export async function readSettingValues(keys: string[]): Promise<Record<string, unknown>> {
    if (keys.length === 0) return {};
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    const raw: Record<string, unknown> = {};
    for (const row of rows) raw[row.key] = row.value;
    return settingsFromStorage(raw);
}

/**
 * The same read, narrowed to what a provider's configuration actually is: a
 * trimmed string, or null when the row is missing, empty, not a string, or a
 * credential this install can no longer decrypt. A caller that gets null shows
 * "not configured" rather than trying to authenticate with nothing.
 *
 * Text the operator wrote per language (`translatable-text.ts`) is its
 * original: a caller asking for a string has no reader's language to ask in,
 * and a site name written in two languages is still a site name.
 */
export async function readSettingStrings(keys: string[]): Promise<Record<string, string | null>> {
    const values = await readSettingValues(keys);
    const out: Record<string, string | null> = {};
    for (const key of keys) {
        const stored = values[key];
        const value = typeof stored === "object" && isTranslatableText(stored) ? originalText(stored) : stored;
        out[key] = typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    }
    return out;
}
