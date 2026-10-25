/**
 * Which source says a string.
 *
 * A string can be shipped by core, by the module it belongs to and by the
 * theme the site is wearing, and edited by the site. The last of those with
 * something to say is what a reader sees: the site's edit over the theme,
 * the theme over the module, the module over core. The catalogue merge and
 * the translation editor both ask this, so it is answered here once.
 * `a-string-is-said-by-its-top-voice` holds it.
 */

/** The prefix the `Translation` table files a theme's rows under. */
export const THEME_SOURCE_PREFIX = "theme:";

/** Where a source speaks: core first, a module over it, a theme over both. */
export function voiceOf(source: string): number {
    if (source === "core") return 0;
    return source.startsWith(THEME_SOURCE_PREFIX) ? 2 : 1;
}

interface Said {
    module: string;
    isCustom: boolean;
}

/**
 * Rows in the order they are heard, the last one winning: every shipped row
 * by voice, then every row the site edited, by voice again. Ties go by source
 * id, so the order never depends on how the rows were read.
 */
export function sortByVoice<T extends Said>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
        if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
        const voice = voiceOf(a.module) - voiceOf(b.module);
        if (voice !== 0) return voice;
        return a.module.localeCompare(b.module);
    });
}

/** What one string says in one language, and who says it. Null when nobody does. */
export function sayingOf<T extends Said & { value: string }>(rows: T[]): { value: string; from: string; isCustom: boolean } | null {
    const top = sortByVoice(rows).at(-1);
    return top ? { value: top.value, from: top.module, isCustom: top.isCustom } : null;
}

/**
 * Where an edit to a string is filed: the source that owns it, the lowest
 * one shipping it. An edit filed on the theme's row would go with the theme;
 * filed here it stays, and is still heard over the theme, as every edit is.
 */
export function ownerOf(sources: string[]): string | null {
    return [...sources].sort((a, b) => voiceOf(a) - voiceOf(b) || a.localeCompare(b))[0] ?? null;
}

/** Whether a source is heard on a site wearing `themeId`: every module, and that theme alone. */
export function isVisibleSource(source: string, themeId: string): boolean {
    return !source.startsWith(THEME_SOURCE_PREFIX) || source === `${THEME_SOURCE_PREFIX}${themeId}`;
}
