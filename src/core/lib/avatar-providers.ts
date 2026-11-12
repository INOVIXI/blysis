/**
 * The picture services the installed modules declare, as the registry lists
 * them.
 *
 * Kept out of `scripts/generate-registry.ts` so the collection can be run in
 * a test rather than read as text: the id it produces is the value the
 * operator's choice is stored as, and a change to its shape would quietly
 * forget every site's choice.
 */
import type { AvatarProviderEntry } from "@/core/lib/member-face";

interface DeclaredProvider {
    id: string;
    labelKey: string;
    url: string;
}

/**
 * Each provider under `<module>.<id>`, so two modules may both call theirs
 * `head`, sorted by that id so the generated file is the same on every run.
 */
export function avatarProvidersOf(
    loaded: readonly { moduleName: string; manifest: { avatarProviders?: readonly DeclaredProvider[] } }[],
): AvatarProviderEntry[] {
    const out: AvatarProviderEntry[] = [];
    for (const { moduleName, manifest } of loaded) {
        for (const p of manifest.avatarProviders ?? []) {
            out.push({
                id: `${moduleName}.${p.id}`,
                module: moduleName,
                labelKey: p.labelKey,
                url: p.url,
                host: new URL(p.url).origin,
            });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
