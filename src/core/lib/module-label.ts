/**
 * What a module is called, in the reader's language.
 *
 * A manifest's `name` and `description` are English, the way every string in
 * a manifest is. The module ships translations for them under
 * `admin.module_<id>_name` and `_description`, and there are two places to
 * read those from, because there are two kinds of row on this screen:
 *
 *   installed - its translations were seeded on install, so the catalogue in
 *   the browser has them and `t.has` finds them.
 *
 *   marketplace - nothing about it is installed, so nothing about it is in
 *   the Translation table. Its row carries its own `i18n` map, written into
 *   the index by build-marketplace.
 *
 * This is one of the few honest uses of a `t.has` guard: the key is built
 * from a module id core does not know.
 *
 * It lived under the modules screen until the widget settings screen was
 * found telling an operator that a widget came "from the store module" -
 * `store` being the directory it lives in. Any screen that has a module id
 * and a reader needs this, so it sits in core's lib beside `widget-label`.
 */

export interface Named {
    id: string;
    /** The manifest's English, where the caller has a manifest to hand. */
    name?: string;
    description?: string;
    i18n?: Record<string, { name: string; description: string }>;
}

export function moduleName(
    mod: Named,
    locale: string,
    t: { has: (key: string) => boolean; (key: string): string },
): string {
    const key = `module_${mod.id}_name`;
    if (t.has(key)) return t(key);
    return mod.i18n?.[locale]?.name ?? mod.name ?? mod.id;
}

export function moduleDescription(
    mod: Named,
    locale: string,
    t: { has: (key: string) => boolean; (key: string): string },
): string {
    const key = `module_${mod.id}_description`;
    if (t.has(key)) return t(key);
    return mod.i18n?.[locale]?.description ?? mod.description ?? "";
}
