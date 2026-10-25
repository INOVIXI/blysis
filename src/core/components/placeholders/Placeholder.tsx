"use client";

import { usePlaceholderFill } from "@/core/hooks/usePlaceholder";

/**
 * One site placeholder's value where a theme puts it: `servers.online` in a
 * badge. Text, whatever the value says. `fallback` is what shows while there
 * is none, the en dash every placeholder shows unless told otherwise.
 */
export function Placeholder({ name, fallback }: { name: string; fallback?: string }) {
    const fill = usePlaceholderFill();
    return <>{fill(fallback === undefined ? `{${name}}` : `{${name}|${fallback}}`)}</>;
}

/** A sentence of the theme's own with site placeholders in it. */
export function PlaceholderText({ text }: { text: string }) {
    const fill = usePlaceholderFill();
    return <>{fill(text)}</>;
}
