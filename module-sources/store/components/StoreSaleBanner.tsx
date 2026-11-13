import { getLocale, getTranslations } from "next-intl/server";
import { BadgePercent } from "lucide-react";
import { dateLocaleTag } from "@/core/sdk";
import { siteTimeZone } from "@/core/sdk/server";
import { runningStoreSales } from "../lib/store-sale-server";
import { readStoreCategories } from "../lib/read-store";

/**
 * What a shopper is told while a store-wide sale runs: how much, on which
 * shelves, and until when.
 *
 * Drawn by the server above the store's own pages, so the reduction is in
 * the HTML the price beside it came in. A sale nobody is told about sells
 * nothing extra, and a price that dropped without a reason reads as a
 * mistake. Nothing is drawn when no sale is running.
 */
export async function StoreSaleBanner() {
    const now = new Date();
    const sales = await runningStoreSales(now);
    if (sales.length === 0) return null;

    const [t, locale, zone] = await Promise.all([getTranslations("store"), getLocale(), siteTimeZone()]);
    const scoped = sales.some((sale) => sale.categoryIds.length > 0);
    const shelves = scoped ? await readStoreCategories(locale) : [];
    const ends = (at: Date) => at.toLocaleString(dateLocaleTag(locale), { timeZone: zone, dateStyle: "medium", timeStyle: "short" });

    // The shelves an operator chose, named once: a sale widened to the
    // shelves under them would otherwise list every child beside its parent.
    const namesOf = (ids: string[]) => {
        const chosen = new Set(ids);
        return shelves
            .filter((shelf) => chosen.has(shelf.id) && !(shelf.parentId && chosen.has(shelf.parentId)))
            .map((shelf) => shelf.name)
            .join(", ");
    };

    const shown = [...sales].sort((a, b) => b.percent - a.percent).slice(0, 3);
    return (
        <div className="mb-6 space-y-2" data-store-sale>
            {shown.map((sale) => {
                const names = sale.categoryIds.length > 0 ? namesOf(sale.categoryIds) : "";
                return (
                    <p
                        key={sale.id}
                        className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground"
                    >
                        <BadgePercent className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" />
                        <span>
                            <strong>
                                {names
                                    ? t("saleBanner_shelves", { percent: sale.percent, shelves: names })
                                    : t("saleBanner_wholeStore", { percent: sale.percent })}
                            </strong>{" "}
                            <span className="text-muted-foreground">{t("saleBanner_until", { date: ends(sale.endsAt) })}</span>
                        </span>
                    </p>
                );
            })}
        </div>
    );
}
