"use client";

import { useCallback, useContext } from "react";
import { PlaceholderContext } from "@/core/components/placeholders/PlaceholderProvider";
import { fillPlaceholderText, type PlaceholderValue } from "@/core/lib/placeholder-text";

/** One site placeholder's value, or undefined while the page does not know it yet. */
export function usePlaceholder(name: string): PlaceholderValue | undefined {
    const { values } = useContext(PlaceholderContext);
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
}

/**
 * A function that fills the site placeholders in a text, numbers written the
 * way the page's language writes them.
 */
export function usePlaceholderFill(): (text: string) => string {
    const { values, formatNumber } = useContext(PlaceholderContext);
    return useCallback((text: string) => fillPlaceholderText(text, values, formatNumber), [values, formatNumber]);
}
