"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { dateLocaleTag, formatCurrency } from "@/core/lib/utils";

/**
 * What money on this site is worth, and how to write it down.
 *
 * There used to be three answers and none of them was this one. Checkout
 * charges in the `default_currency` setting; the store's admin screens called
 * `formatCurrency(x)` with no arguments, which is USD in `en-US`; the admin
 * dashboard and the analytics charts glued a `$` on by hand. So a shop
 * charging in lira showed every order, product, coupon and gift code as
 * `$1,250.00`, and the buyer's own order history said the same. The number
 * was not converted either: it was the lira figure with a dollar sign.
 *
 * Two more copies of a `CurrencyProvider` sat in the store and the
 * leaderboard, each with its own `localStorage` key, and neither was ever
 * mounted - every `useCurrency()` in those modules fell through to a default
 * context whose formatter was `` `$${amount.toFixed(2)}` ``. Meanwhile the
 * currency module mounted a fourth provider, app-wide, that nothing outside
 * that module could import. Its footer selector changed a value no page read.
 *
 * Core owns the base currency because core owns the setting the payment
 * gateways charge in. It does not own exchange rates and does not want to:
 * a module that knows them calls `setDisplay({ code, rate })` and every price
 * on the site follows. `null` clears the visitor's choice.
 *
 * A site can also say what a visitor who never chose should read, through
 * `setDefaultDisplay`. That one is held for the page and never stored: saved
 * like a choice, it would stay the visitor's forever, and an operator who
 * later picked another default would never reach them. The visitor's own
 * choice wins over it. Both are applied after mount, so the server and the
 * first browser render draw the base and hydrate against the same text
 * (`a-new-visitor-reads-the-sites-chosen-currency`).
 */

export interface DisplayCurrency {
    /** ISO 4217 code the visitor wants to read prices in. */
    code: string;
    /** How many display units one base unit buys. */
    rate: number;
}

export interface SiteCurrency {
    /** What the site charges in, from the `default_currency` setting. */
    base: string;
    /** What prices are written in - the base unless a module set otherwise. */
    code: string;
    /** Format an amount given in the BASE currency, converting if needed. */
    format: (amount: number | string | null | undefined) => string;
    /** The visitor's own choice, stored; `null` clears it. */
    setDisplay: (display: DisplayCurrency | null) => void;
    /** What a visitor with no choice reads; `null` is the base. Never stored. */
    setDefaultDisplay: (display: DisplayCurrency | null) => void;
    /** True when what is shown is the visitor's own choice. */
    chosen: boolean;
    /** False until the site settings have arrived; prices render as base. */
    loaded: boolean;
}

const STORAGE_KEY = "blysis_display_currency";
const DEFAULT_BASE = "USD";

const SiteCurrencyContext = createContext<SiteCurrency | null>(null);

function readStored(): DisplayCurrency | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DisplayCurrency>;
        if (typeof parsed?.code !== "string" || typeof parsed?.rate !== "number") return null;
        if (!(parsed.rate > 0)) return null;
        return { code: parsed.code.toUpperCase(), rate: parsed.rate };
    } catch {
        return null;
    }
}

export function SiteCurrencyProvider({ children }: { children: React.ReactNode }) {
    const { settings, loaded } = useSiteSettings();
    const locale = useLocale();
    const [choice, setChoice] = useState<DisplayCurrency | null>(null);
    const [fallbackDisplay, setFallbackDisplay] = useState<DisplayCurrency | null>(null);

    useEffect(() => {
        const stored = readStored();
        if (stored) setChoice(stored);
    }, []);

    const base = useMemo(() => {
        const configured = settings.default_currency;
        return typeof configured === "string" && configured.trim()
            ? configured.trim().toUpperCase()
            : DEFAULT_BASE;
    }, [settings.default_currency]);

    const setDisplay = useCallback((next: DisplayCurrency | null) => {
        setChoice(next);
        try {
            if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // Private mode, or storage full. The choice still holds for this
            // page; it just will not survive a reload.
        }
    }, []);

    const setDefaultDisplay = useCallback((next: DisplayCurrency | null) => {
        setFallbackDisplay(next);
    }, []);

    const value = useMemo<SiteCurrency>(() => {
        const display = choice ?? fallbackDisplay;
        const code = display?.code ?? base;
        const rate = display?.rate ?? 1;
        return {
            base,
            code,
            loaded,
            setDisplay,
            setDefaultDisplay,
            chosen: choice !== null,
            format: (amount) => formatCurrency((Number(amount) || 0) * rate, code, dateLocaleTag(locale)),
        };
    }, [base, choice, fallbackDisplay, loaded, locale, setDisplay, setDefaultDisplay]);

    return <SiteCurrencyContext value={value}>{children}</SiteCurrencyContext>;
}

/**
 * The site's currency and a formatter for it.
 *
 * Safe outside the provider: prices fall back to the base currency written in
 * the reader's locale, which is what a screen rendered before any of this
 * existed should have been doing anyway.
 */
export function useSiteCurrency(): SiteCurrency {
    const ctx = useContext(SiteCurrencyContext);
    const locale = useLocale();
    const fallback = useMemo<SiteCurrency>(
        () => ({
            base: DEFAULT_BASE,
            code: DEFAULT_BASE,
            loaded: false,
            setDisplay: () => {},
            setDefaultDisplay: () => {},
            chosen: false,
            format: (amount) => formatCurrency(Number(amount) || 0, DEFAULT_BASE, dateLocaleTag(locale)),
        }),
        [locale],
    );
    return ctx ?? fallback;
}
