/**
 * What this version ships for one string, whoever ships it.
 *
 * Core reads its catalogue off disk; a module carries its own inside the
 * manifest it was installed from, and a theme inside its `theme.json`, whose
 * rows are filed under `theme:<id>`. The translation editor asks the same
 * question of both - what did this say before anybody edited it? - so the
 * difference is settled here rather than at every call site.
 *
 * Core names no module in doing so: the id arrives as data, from a row.
 */

import { themeRegistry } from "@/core/generated/theme-registry";
import { moduleLoader } from "@/core/lib/module-loader";
import { isUnsafeKey } from "@/core/lib/safe-object";
import { messageAt, shippedMessages } from "./shipped-messages";
import { THEME_SOURCE_PREFIX } from "./translation-layers";

/** The id the `Translation` table gives rows that are not a module's. */
const CORE_MODULE = "core";

/** A namespace holding one string rather than a tree writes it under this. */
const ROOT_KEY = "_root";

function namespaceOf(
    catalogue: Record<string, unknown> | undefined,
    namespace: string,
): unknown {
    if (!catalogue || isUnsafeKey(namespace)) return undefined;
    return Object.prototype.hasOwnProperty.call(catalogue, namespace) ? catalogue[namespace] : undefined;
}

function themeCatalogue(themeId: string, locale: string): Record<string, unknown> | undefined {
    if (!Object.prototype.hasOwnProperty.call(themeRegistry, themeId)) return undefined;
    const translations = (themeRegistry[themeId] as { translations?: Record<string, Record<string, unknown>> }).translations;
    return translations && Object.prototype.hasOwnProperty.call(translations, locale) ? translations[locale] : undefined;
}

export function shippedValue(
    moduleId: string,
    locale: string,
    namespace: string,
    key: string,
): string | null {
    const catalogue = moduleId === CORE_MODULE
        ? (shippedMessages(locale) as Record<string, unknown>)
        : moduleId.startsWith(THEME_SOURCE_PREFIX)
            ? themeCatalogue(moduleId.slice(THEME_SOURCE_PREFIX.length), locale)
            : (moduleLoader.getModule(moduleId)?.manifest.translations?.[locale] as Record<string, unknown> | undefined);

    const found = namespaceOf(catalogue, namespace);
    if (typeof found === "string") return key === ROOT_KEY ? found : null;
    if (typeof found !== "object" || found === null) return null;
    return messageAt(found as Record<string, unknown>, key);
}
