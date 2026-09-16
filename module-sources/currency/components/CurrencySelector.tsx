"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { FooterDropdown, useSiteCurrency } from "@/core/sdk/ui";

interface ConfiguredCurrency {
    code: string;
    symbol: string;
    rate: number;
    enabled?: boolean;
}

interface CurrencyConfig {
    base: string;
    currencies: ConfiguredCurrency[];
}

/**
 * The footer's currency picker.
 *
 * It used to write the visitor's choice into a React context defined inside
 * this module, which no page outside this module could import. The store and
 * the leaderboard each shipped their own copy of that context, neither of
 * them mounted, so every price on the site was drawn by the copies' default
 * formatter: a dollar sign glued to an unconverted number. Picking a currency
 * here changed nothing anywhere.
 *
 * Core owns the price formatter now. This module still owns the rates: it
 * hands core a code and how many of that currency one unit of the site's own
 * currency buys, and every price on the site follows.
 */
export function CurrencySelector() {
    const { base, code, setDisplay } = useSiteCurrency();
    const [config, setConfig] = useState<CurrencyConfig | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/currency")
            .then((r) => (r.ok ? r.json() : null))
            .then((d: CurrencyConfig | null) => {
                if (cancelled || !d?.currencies) return;
                setConfig(d);
            })
            .catch(() => {
                // No config endpoint, no picker: the base currency stands.
            });
        return () => { cancelled = true; };
    }, []);

    const list = (config?.currencies ?? []).filter((c) => c.enabled !== false && c.rate > 0);
    // The configured rates are quoted against the config's own base, which is
    // not necessarily what this site charges in. Re-quote them against the
    // site's currency so a price never gets converted twice.
    const baseRate = list.find((c) => c.code === base)?.rate;
    const options = baseRate ? list : list.filter((c) => c.code === config?.base);

    /*
     * Nothing is drawn until `/api/v1/currency` answers, and the row it then
     * adds is a row the footer did not have. Measured on a production build
     * at 1280px: `/tr/forum` was 2791px at load and 2830px once the answer
     * arrived, and the footer is on every page on the site.
     *
     * So the room is held while the answer is outstanding. A site that turns
     * out to have fewer than two currencies collapses the row once, which is
     * a single shift on a site that offers no picker at all - against one on
     * every page load for every site that does.
     */
    if (!config) {
        return <div className="h-5" aria-hidden="true" />;
    }

    if (options.length < 2 || !baseRate) return null;

    const choose = (next: string) => {
        if (next === base) { setDisplay(null); return; }
        const target = options.find((c) => c.code === next);
        if (!target) return;
        setDisplay({ code: target.code, rate: target.rate / baseRate });
    };

    // The code alone. A symbol beside it says the same thing twice, and the
    // three-letter code is the part a reader is looking for.
    const label = (c: string) => c;

    // The icon is `Coins` and not a currency glyph on purpose. This control
    // offers several currencies, so a dollar sign beside it was wrong for two
    // of the three the demo ships - it stayed a dollar while the label read
    // EUR. Something that means "money" is right whatever is selected, and it
    // keeps this row looking like the language row above it, which is what the
    // footer's settings column is: a label, an icon, a dropdown.
    return (
        <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <FooterDropdown
                options={options.map((c) => c.code)}
                value={code}
                onChange={choose}
                formatLabel={label}
            />
        </div>
    );
}

export default CurrencySelector;
