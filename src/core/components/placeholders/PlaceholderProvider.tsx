"use client";

import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormatter } from "next-intl";
import { sharedJson } from "@/core/lib/shared-request";
import type { PlaceholderValue } from "@/core/lib/placeholder-text";

/**
 * The site placeholders' values as this page knows them, and how a number
 * among them is written in the page's language. The formatter travels with
 * the values so a reader of them needs no other context: outside the provider
 * there are no values and a number is its digits.
 */
export const PlaceholderContext = createContext<{
    values: Record<string, PlaceholderValue>;
    formatNumber: (value: number) => string;
}>({ values: {}, formatNumber: String });

/**
 * Hands the page the site placeholders' values the server had ready, and asks
 * the endpoint, once, for the ones it did not.
 *
 * The layout waits only a moment for them, so a value that was not in the
 * cache does not hold up the page; it arrives after the page has painted, in
 * the one request every placeholder on the page shares.
 */
export function PlaceholderProvider({ values, pending, children }: {
    values: Record<string, PlaceholderValue>;
    /** Asked on the server and not ready by the time the page was sent. */
    pending: string[];
    children: ReactNode;
}) {
    const [known, setKnown] = useState(values);
    const format = useFormatter();
    const waiting = pending.length > 0;

    useEffect(() => {
        if (!waiting) return;
        let active = true;
        sharedJson<{ values?: Record<string, PlaceholderValue> }>("/api/v1/placeholders")
            .then((d) => { if (active && d?.values) setKnown((before) => ({ ...before, ...d.values })); })
            .catch(() => {});
        return () => { active = false; };
    }, [waiting]);

    const page = useMemo(() => ({ values: known, formatNumber: (value: number) => format.number(value) }), [known, format]);
    return <PlaceholderContext.Provider value={page}>{children}</PlaceholderContext.Provider>;
}
