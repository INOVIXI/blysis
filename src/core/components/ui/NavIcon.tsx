"use client";

import type { ComponentType } from "react";
import { DynamicIcon, iconNames } from "lucide-react/dynamic";
import { resolveIconName } from "@/core/lib/icon-names";

/**
 * Lucide icon resolved by string name. Admin-supplied (navbar editor,
 * module manifests) so it must accept any valid Lucide identifier -
 * not a hardcoded whitelist. Names are case-insensitive: both
 * "ShoppingBag" and "shopping-bag" map to the same icon, and so does
 * "Gamepad2", which lucide itself spells "gamepad-2".
 *
 * Renders nothing if the name doesn't match a Lucide icon, so a typo
 * degrades to "no icon" instead of breaking the page - and, since the name
 * is checked here rather than inside `DynamicIcon`, without a console
 * warning per render either. Callers that would rather show something than
 * nothing pass a `fallback`.
 *
 * Three screens used to answer the same question with
 * `import * as LucideIcons from "lucide-react"` and `lib[name] || Package`.
 * A namespace import cannot be shaken: each of the three pulled the whole
 * barrel and all 1,723 icon modules into its own route's chunk group, and
 * Turbopack gave each group a private copy. Measured on a production build,
 * that was 189 KB gzipped on every module page, 191 KB on all 48 admin
 * routes, and 1.94 MB of duplicate chunks on disk. `lucide-react/dynamic`
 * fetches one icon's chunk instead.
 */
export function NavIcon({
    name,
    className,
    size,
    fallback: Fallback,
}: {
    name?: string | null;
    className?: string;
    /**
     * Pixels, for a caller that sizes its icons with the attribute rather than
     * with a class. The admin rail does - `<Icon size={18} />` - and dropping
     * it left a module's icon at lucide's own default of 24 beside core's 18,
     * which is how "the module icons are huge" reached me.
     */
    size?: number;
    /** Drawn when the name is missing or names no icon. */
    fallback?: ComponentType<{ className?: string; size?: number }>;
}) {
    const nothing = Fallback ? <Fallback className={className} size={size} /> : null;
    if (!name) return nothing;
    const resolved = resolveIconName(name, iconNames);
    if (!resolved) return nothing;
    /*
     * The Suspense fallback has to be the same box as the icon, because it is
     * what is on screen until the icon's chunk arrives and it is swapped for
     * it. A `<span>` was not: an inline box ignores `h-4`, so the stand-in
     * reserved a line and the icon reserved sixteen pixels. Measured on a
     * production build, `/tr/forum` grew 39px after load.
     *
     * An empty `<svg>` carrying the same class and the same width and height
     * is the icon's box by construction, and lucide's own default of 24 is
     * what it falls back to when the caller sizes with a class alone.
     */
    const box = size ?? 24;
    const placeholder = () => (
        <svg className={className} width={box} height={box} aria-hidden="true" />
    );
    return (
        <DynamicIcon
            name={resolved as Parameters<typeof DynamicIcon>[0]["name"]}
            className={className}
            {...(size === undefined ? {} : { size })}
            fallback={placeholder}
        />
    );
}
