/**
 * The name an operator knows a translation source by.
 *
 * The `Translation` table files rows under `core`, a module's id or
 * `theme:<id>`, and an id is not what the panel calls a module or a theme.
 * Core has no name here: the screen says it in the reader's language.
 */
import { themeRegistry } from "@/core/generated/theme-registry";
import { moduleLoader } from "@/core/lib/module-loader";
import { THEME_SOURCE_PREFIX } from "@/core/lib/i18n/translation-layers";

export function sourceName(source: string): string | null {
    if (source === "core") return null;
    if (source.startsWith(THEME_SOURCE_PREFIX)) {
        const id = source.slice(THEME_SOURCE_PREFIX.length);
        return Object.prototype.hasOwnProperty.call(themeRegistry, id) ? themeRegistry[id].name : id;
    }
    return moduleLoader.getModule(source)?.manifest.name ?? source;
}
