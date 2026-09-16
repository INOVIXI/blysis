"use client";

import { useState } from "react";
import { useRouter } from "@/core/sdk/navigation";
import { useTranslations } from "next-intl";

/**
 * The search band, which puts what it is given in the address.
 *
 * It used to filter into client state, so a search had no address to share and
 * the page's own HTML held no link to anything. The results are read by the
 * server now, and a search is one more address the help centre has.
 */
export function HelpSearch({ initial }: { initial: string }) {
    const t = useTranslations("helpCenter");
    const router = useRouter();
    const [value, setValue] = useState(initial);

    return (
        <form
            role="search"
            onSubmit={(event) => {
                event.preventDefault();
                const term = value.trim();
                router.push(term ? `/help?q=${encodeURIComponent(term)}` : "/help");
            }}
            className="flex gap-2 max-w-xl"
        >
            <input
                type="search"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="flex-1 min-w-0 px-4 py-3 rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-white"
            />
            <button type="submit" className="px-6 py-3 bg-card/20 hover:bg-card/30 rounded-lg font-medium transition-colors">
                {t("search")}
            </button>
        </form>
    );
}
