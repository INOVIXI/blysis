"use client";

import { useEffect, useState } from "react";
import { useFormatter } from "next-intl";
import { useSession } from "next-auth/react";
import { invalidateShared, sharedJson } from "@/core/sdk";
import { usePathname } from "@/core/sdk/navigation";

/**
 * The balance URL every small reader shares. The profile tab asks for a page
 * of history with its own query, so it is a different entry on purpose: this
 * one is only ever read for `balance`, and one string keeps the bar's chip,
 * the account menu and the shop's strip on one request.
 */
const BALANCE_URL = "/api/v1/credits?limit=1";

/**
 * Short, so a page change after a purchase or a transfer reads the new
 * balance, and long enough that the three readers on one page share it.
 */
const FRESH_MS = 5_000;

/** Fired on `window` after something on this page moved the balance. */
const BALANCE_CHANGED_EVENT = "credits:changed";

/**
 * Say the balance changed, so every reader on the page asks again. The entry
 * is dropped here, once, rather than by each listener: three listeners each
 * dropping it would each start a request of their own.
 */
export function announceBalanceChanged(): void {
    invalidateShared(BALANCE_URL);
    window.dispatchEvent(new CustomEvent(BALANCE_CHANGED_EVENT));
}

interface CreditBalance {
    /** The balance, or null while unknown, signed out, or when it could not be read. */
    balance: number | null;
    /** The balance written for this reader, two decimals, their separator. */
    formatted: string;
}

/**
 * A signed-in member's balance, for the places that only show the number.
 *
 * It reads again on every page change: there is no event for a balance moved
 * by a checkout on another page, and the page a purchase lands on is a page
 * change.
 */
export function useCreditBalance(): CreditBalance {
    const { data: session } = useSession();
    const pathname = usePathname();
    const format = useFormatter();
    const [balance, setBalance] = useState<number | null>(null);
    const [changes, setChanges] = useState(0);
    const signedIn = Boolean(session?.user);

    useEffect(() => {
        const onChange = () => setChanges((n) => n + 1);
        window.addEventListener(BALANCE_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(BALANCE_CHANGED_EVENT, onChange);
    }, []);

    useEffect(() => {
        if (!signedIn) {
            setBalance(null);
            return;
        }
        let active = true;
        sharedJson<{ balance?: number | string }>(BALANCE_URL, FRESH_MS)
            .then((d) => { if (active) setBalance(Number(d?.balance ?? 0)); })
            .catch(() => { if (active) setBalance(null); });
        return () => { active = false; };
    }, [signedIn, pathname, changes]);

    const formatted = balance === null
        ? ""
        : format.number(balance, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return { balance, formatted };
}
