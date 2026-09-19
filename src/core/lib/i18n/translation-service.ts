/**
 * Database-backed translation service.
 *
 * Translations live in the `Translation` table. Core translations are seeded
 * from `messages-core/*.json`. Module translations are written on install and
 * deleted on uninstall. Admin overrides (`isCustom = true`) always win.
 *
 * The merged message object is cached (Redis or in-memory) and invalidated
 * on module install/uninstall/enable/disable or admin edit.
 *
 * This replaces the build-time `clean-translations.ts` merge.
 */

import { prisma } from "@/core/lib/db";
import { shippedMessages } from "@/core/lib/i18n/shipped-messages";
import { defaultThemeId } from "@/core/generated/theme-registry";
import { cacheGet, cacheSet, cacheDel } from "@/core/lib/redis";
import { isUnsafeKey, emptyRecord } from "@/core/lib/safe-object";

const CACHE_PREFIX = "blysis:translations:";
const CACHE_TTL_SECONDS = 120;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the full nested message object for a locale.
 * Called by next-intl's `getRequestConfig` on every request.
 */
/** The theme id alone, without the mode, the customization or the cookie. */
async function activeThemeId(): Promise<string> {
    try {
        const state = await prisma.themeState.findFirst({ select: { themeId: true } });
        return state?.themeId ?? defaultThemeId;
    } catch {
        // A read that fails leaves the theme's own labels falling back to the
        // literals in its manifest, which is what they did before this.
        return defaultThemeId;
    }
}

export async function getMessages(locale: string): Promise<Record<string, unknown>> {
    const cacheKey = CACHE_PREFIX + locale;

    // 1. Try cache
    const cached = await cacheGet(cacheKey);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch { /* fall through */ }
    }

    // 2. Query DB - only core + enabled modules
    const enabledModuleIds = await getEnabledModuleIds();
    /*
     * The theme the site is wearing, whose settings screens are drawn from
     * its own strings.
     *
     * A theme's manifest has carried a `translations` block since it was
     * written and nothing read it, so every label on every theme settings
     * screen was the English literal beside it. Its rows are filed under
     * `theme:<id>` and would be filtered out here with everything else that
     * is not core or an enabled module.
     *
     * One row, on a cache miss only - this whole catalogue is held for two
     * minutes - and deliberately not `getActiveTheme`, which reads the
     * visitor's cookie and three more tables. Which theme is on does not
     * depend on who is asking.
     */
    const themeId = await activeThemeId();
    const allowedModules = ["core", ...enabledModuleIds, `theme:${themeId}`];

    const rows = await prisma.translation.findMany({
        where: {
            locale,
            module: { in: allowedModules },
        },
        select: {
            namespace: true,
            key: true,
            value: true,
            module: true,
            isCustom: true,
        },
    });

    // 3. Sort with explicit priority then merge: later writes win.
    //    Priority (lowest first): core non-custom, module non-custom, any custom.
    //    Plain alphabetical `module ASC` would put "blog" before "core" and
    //    let blog overwrite core, which is the opposite of the intent.
    rows.sort((a, b) => {
        if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
        const aIsCore = a.module === "core";
        const bIsCore = b.module === "core";
        if (aIsCore !== bIsCore) return aIsCore ? -1 : 1;
        return a.module.localeCompare(b.module);
    });

    // What this version ships, then what the database says. A row wins
    // wherever there is one; a string nobody has seeded yet is still a string.
    const messages: Record<string, Record<string, unknown>> = {};
    for (const [namespace, values] of Object.entries(shippedMessages(locale))) {
        if (isUnsafeKey(namespace) || !values || typeof values !== "object") continue;
        // Flattened and then re-nested rather than copied across, so the file
        // arrives by the same road a row does. A catalogue entry may be
        // written either way - `{ "err": { "demo_disabled": ... } }` or the
        // flat `"err.demo_disabled"` - and next-intl accepts only the first,
        // so the dot has to be spent here whichever form it arrived in.
        const target = emptyRecord();
        flattenObject(values as Record<string, unknown>, "", (key, value) => {
            setNestedValue(target, key, value);
        });
        messages[namespace] = target;
    }

    for (const row of rows) {
        if (!messages[row.namespace]) messages[row.namespace] = emptyRecord();
        setNestedValue(messages[row.namespace], row.key, row.value);
    }

    // 4. Cache and return
    //
    // Return the round-tripped copy, not `messages` itself. next-intl hands
    // this tree to a client provider, and React refuses to serialize an
    // object with a null prototype across that boundary - which is exactly
    // what the accumulators above are. A cache hit already returned parsed
    // JSON, so the two paths disagreed and only a cold cache threw:
    // "Only plain objects ... can be passed to Client Components".
    const json = JSON.stringify(messages);
    await cacheSet(cacheKey, json, CACHE_TTL_SECONDS);

    return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Write a module's translations to the DB. Called during module install.
 * Translations come from `module.json` `translations` field:
 * ```json
 * { "en": { "admin": { "menu_blog": "Blog" }, "blog": { "title": "Blog" } } }
 * ```
 */
export async function syncModuleTranslations(
    moduleId: string,
    translations: Record<string, Record<string, unknown>>,
): Promise<void> {
    const rows = flattenTranslations(moduleId, translations);
    if (rows.length === 0) return;

    // Two-pass write: first updateMany to refresh existing non-custom rows
    // only, then upsert to create any missing rows. Admin-customized rows
    // (isCustom = true) keep the operator's value across reinstalls.
    const CHUNK_SIZE = 200;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        await Promise.all(
            chunk.map((r) =>
                prisma.translation.updateMany({
                    where: {
                        locale: r.locale,
                        namespace: r.namespace,
                        key: r.key,
                        module: r.module,
                        isCustom: false,
                    },
                    data: { value: r.value },
                }),
            ),
        );
        await Promise.all(
            chunk.map((r) =>
                prisma.translation.upsert({
                    where: {
                        locale_namespace_key_module: {
                            locale: r.locale,
                            namespace: r.namespace,
                            key: r.key,
                            module: r.module,
                        },
                    },
                    update: {},
                    create: r,
                }),
            ),
        );
    }

    await invalidateTranslationCache();
}

/**
 * Remove all translations for a module. Called during module uninstall.
 * Admin overrides (isCustom = true) are preserved.
 */
export async function removeModuleTranslations(moduleId: string): Promise<void> {
    await prisma.translation.deleteMany({
        where: { module: moduleId, isCustom: false },
    });
    await invalidateTranslationCache();
}

/**
 * Invalidate the translation cache for all locales.
 * Call after install, uninstall, enable, disable, or admin edit.
 */
export async function invalidateTranslationCache(): Promise<void> {
    // Delete known locale caches
    const { locales } = await import("./config");
    await Promise.all(
        locales.map((l: string) => cacheDel(CACHE_PREFIX + l)),
    );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function getEnabledModuleIds(): Promise<string[]> {
    const modules = await prisma.moduleConfig.findMany({
        where: { enabled: true },
        select: { id: true },
    });
    return modules.map((m) => m.id);
}

/**
 * Flatten module translations into DB row format.
 * Input: { "en": { "admin": { "key": "val" }, "blog": { "title": "Blog" } } }
 * Output: [{ locale: "en", namespace: "admin", key: "key", value: "val", module }]
 */
function flattenTranslations(
    moduleId: string,
    translations: Record<string, Record<string, unknown>>,
): { locale: string; namespace: string; key: string; value: string; module: string }[] {
    const rows: { locale: string; namespace: string; key: string; value: string; module: string }[] = [];

    for (const [locale, namespaces] of Object.entries(translations)) {
        if (typeof namespaces !== "object" || namespaces === null) continue;
        for (const [namespace, content] of Object.entries(namespaces)) {
            if (typeof content === "string") {
                rows.push({ locale, namespace, key: "_root", value: content, module: moduleId });
            } else if (typeof content === "object" && content !== null) {
                flattenObject(content as Record<string, unknown>, "", (key, value) => {
                    rows.push({ locale, namespace, key, value: String(value), module: moduleId });
                });
            }
        }
    }

    return rows;
}

function flattenObject(
    obj: Record<string, unknown>,
    prefix: string,
    emit: (key: string, value: string) => void,
): void {
    for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            flattenObject(v as Record<string, unknown>, fullKey, emit);
        } else {
            emit(fullKey, String(v ?? ""));
        }
    }
}

function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: string): void {
    const parts = dotPath.split(".");
    // Reject prototype-polluting keys anywhere in the path.
    if (parts.some(isUnsafeKey)) return;
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (typeof current[part] !== "object" || current[part] === null) {
            current[part] = emptyRecord();
        }
        current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
}
