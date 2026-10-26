"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePlaceholderFill } from "@/core/hooks/usePlaceholder";

export type ThemeConfigValue = Record<string, unknown>;

const ThemeConfigContext = createContext<ThemeConfigValue>({});

/** `group.field` for every text field the theme marked `"placeholders": true`. */
const PlaceholderFieldsContext = createContext<ReadonlySet<string>>(new Set());

export function ThemeConfigProvider({ value, placeholderFields, children }: {
    value: ThemeConfigValue;
    placeholderFields?: ReadonlySet<string>;
    children: ReactNode;
}) {
    // Callers pass a server-resolved snapshot - the reference is stable for
    // the request lifetime, so there's no benefit to a useMemo wrapper here.
    // Dropping it also keeps the react-hooks lint happy without introducing
    // a JSON.stringify dependency expression.
    return (
        <ThemeConfigContext.Provider value={value}>
            <PlaceholderFieldsContext.Provider value={placeholderFields ?? NO_FIELDS}>{children}</PlaceholderFieldsContext.Provider>
        </ThemeConfigContext.Provider>
    );
}

const NO_FIELDS: ReadonlySet<string> = new Set();

/**
 * A setting of the active theme by `group.field`. A text field the theme
 * marked `"placeholders": true` comes back with its site placeholders filled,
 * so an operator's `{servers.online}` reaches the page without the theme
 * doing anything but asking for the field.
 */
export function useThemeConfig() {
    const ctx = useContext(ThemeConfigContext);
    const placeholderFields = useContext(PlaceholderFieldsContext);
    const fill = usePlaceholderFill();
    return function get<T = unknown>(path: string, fallback?: T): T | undefined {
        const parts = path.split(".");
        let cur: unknown = ctx;
        for (const p of parts) {
            if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
                cur = (cur as Record<string, unknown>)[p];
            } else {
                cur = undefined;
                break;
            }
        }
        const found = (cur as T) ?? fallback;
        return typeof found === "string" && placeholderFields.has(path) ? (fill(found) as T) : found;
    };
}

/**
 * The active theme's settings by group, as the server read them, with the
 * customizer's preview over them: what `resolvePageLayout` takes for the
 * settings an arrangement leaves to the operator.
 */
export function useThemeSettings(): Record<string, Record<string, unknown>> {
    return useContext(ThemeConfigContext) as Record<string, Record<string, unknown>>;
}
