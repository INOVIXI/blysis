"use client";

import { useState, useEffect } from "react";
import { Link } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Package } from "lucide-react";
import { DynamicIcon, iconNames } from "lucide-react/dynamic";
import { resolveIconName } from "@/core/lib/icon-names";
import { useAllModules } from "@/core/providers/module-provider";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { useSiteCurrency } from "@/core/components/currency/site-currency";
import { badgeClassName, type BadgeTone } from "@/core/components/ui/badge";

interface ModuleManifest {
    id: string;
    statsApi?: string;
    dashboardCards?: DashboardCard[];
}

function CardIcon({ name, className }: { name: string; className?: string }) {
    const resolved = name ? resolveIconName(name, iconNames) : null;
    if (!resolved) return <Package className={className} />;
    return (
        <DynamicIcon
            name={resolved as React.ComponentProps<typeof DynamicIcon>["name"]}
            className={className}
            fallback={() => <Package className={className} />}
        />
    );
}

// A module names a colour in its manifest, from a fixed list. They map onto
// the badge's tones rather than onto Tailwind's palette, so a module's badge
// follows the theme like every other one.
const badgeTones: Record<string, BadgeTone> = {
    green: "success",
    yellow: "warning",
    blue: "info",
    red: "danger",
    gray: "neutral",
};

interface DashboardCard {
    id: string;
    label: string;
    labelKey?: string;
    icon: string;
    href: string;
    color: string;
    statKey: string;
    module: string;
}

interface SectionItem {
    id: string;
    href?: string;
    primary: string;
    secondary?: string;
    badge?: string;
    /**
     * Said in the reader's language, where the sender has a key for it. The
     * ticket card sent `t.status` and this drew it, so the first screen an
     * operator opens said WAITING_REPLY in English capitals.
     */
    badgeKey?: string;
    badgeColor?: string;
    value?: string;
}

interface DashboardSection {
    id: string;
    title: string;
    titleKey?: string;
    viewAllHref?: string;
    items: SectionItem[];
}

/**
 * Shared data-fetch hook - one call to /api/v1/modules + each enabled
 * module's statsApi endpoint. All three dashboard subcomponents below
 * read from the same hook so we only hit the network once per render.
 */
function useModuleDashboardData() {
    const modules = useAllModules();
    const [cards, setCards] = useState<DashboardCard[]>([]);
    const [stats, setStats] = useState<Record<string, string | number>>({});
    const [sections, setSections] = useState<DashboardSection[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/modules")
            .then(r => r.json())
            .then(async (data) => {
                if (cancelled) return;
                const enabledModules = ((data.modules || []) as ModuleManifest[]).filter((m) => isEnabledIn(modules, m.id));

                const allCards: DashboardCard[] = [];
                const allStats: Record<string, string | number> = {};
                const allSections: DashboardSection[] = [];

                const fetches = enabledModules
                    .filter((m) => m.statsApi)
                    .map(async (m) => {
                        try {
                            const res = await fetch(`/api/v1${m.statsApi}`);
                            if (!res.ok) return;
                            const d = await res.json();
                            if (d.stats) Object.assign(allStats, d.stats);
                            if (d.sections) allSections.push(...d.sections);
                        } catch { /* skip failed module */ }
                    });

                await Promise.all(fetches);

                for (const m of enabledModules) {
                    if (m.dashboardCards) {
                        for (const card of m.dashboardCards) {
                            allCards.push({ ...card, module: m.id });
                        }
                    }
                }

                setCards(allCards);
                setStats(allStats);
                setSections(allSections);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [modules]);

    return { cards, stats, sections, loading };
}

function formatValue(
    key: string,
    value: string | number | undefined,
    money: (amount: number | string | null | undefined) => string,
): string | number {
    if (value === undefined) return 0;
    // A module's revenue card is denominated in whatever the gateways charge
    // in. This used to write it with a dollar sign whatever that was.
    if (key === "revenue") return money(value);
    return value || 0;
}

/** The layout id a module card or panel is stored under. Mirrors core. */
function widgetId(kind: "card" | "section", moduleId: string, id: string): string {
    return kind === "section" ? `mod:${moduleId}:section:${id}` : `mod:${moduleId}:${id}`;
}

/**
 * The KPI row.
 *
 * `order` names the core cards in the order the page wants them; `coreSlots`
 * carries those cards, rendered on the server and handed down as nodes,
 * because the row itself fetches the module cards and appends them after.
 */
export function DashboardKpiRow({ order, coreSlots }: {
    order: string[];
    coreSlots: Record<string, React.ReactNode>;
}) {
    const { cards, stats, loading } = useModuleDashboardData();
    const t = useTranslations("admin");
    /*
     * The root of the catalogue, for a key that names its own namespace.
     *
     * A module's dashboard keys live in its `admin` block and resolve here
     * without a prefix. A word a module already has elsewhere does not: the
     * ticket states are `tickets.open` and the nine of them, and asking a
     * module to keep a second copy of each under `admin` is the shadow
     * catalogue that has had to be deleted once already.
     */
    const rootT = useTranslations();
    const { format: money } = useSiteCurrency();

    const translateLabel = (raw: string, key?: string): string => {
        if (!key) return raw;
        try {
            const translated = key.includes(".") ? rootT(key) : t(key);
            return translated && translated !== key ? translated : raw;
        } catch {
            return raw;
        }
    };

    const byId = new Map(cards.map((card) => [widgetId("card", card.module, card.id), card]));

    return (
        <>
            {order.map((id) => {
                /*
                 * The widget itself is the grid item. It used to be wrapped in
                 * a bare `<div>`, and that broke every card's height: the grid
                 * stretched the div, the `<Link>` inside it sized to its
                 * content, and the `h-full` on the card resolved against that
                 * auto height and did nothing. A card with two lines of
                 * content came out shorter than the three-line ones beside it,
                 * which is what a reader sees as the boxes being different
                 * sizes. The element already carries its own key.
                 */
                if (coreSlots[id]) return coreSlots[id];
                if (!id.startsWith("mod:")) return null;
                const card = byId.get(id);
                // The row knows how many cards it will have before they
                // arrive, so an empty one holds the place rather than letting
                // the grid reflow when the numbers land. It draws nothing
                // inside: four spinners in a row of four boxes says less than
                // the four boxes already say.
                if (!card) return loading ? <Card key={id} aria-busy="true" className="h-full" /> : null;
                return (
                    <Link key={id} href={card.href} className="block h-full">
                        <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                        {translateLabel(card.label, card.labelKey)}
                                    </span>
                                    <CardIcon name={card.icon} className={`w-4 h-4 ${card.color}`} />
                                </div>
                                <div className="text-2xl font-bold">{formatValue(card.statKey, stats[card.statKey], money)}</div>
                            </CardContent>
                        </Card>
                    </Link>
                );
            })}
        </>
    );
}

/**
 * Module-contributed section panels (e.g. open tickets, latest orders,
 * recent forum topics). Rendered as a 2-col grid of larger Cards.
 */
export function ModuleSections() {
    const { sections, loading } = useModuleDashboardData();
    const t = useTranslations("admin");
    // The root of the catalogue, for a key that names its own namespace. See
    // `DashboardKpiRow` above: a word a module already has elsewhere should
    // not need a second copy under `admin`.
    const rootT = useTranslations();

    const translateLabel = (raw: string, key?: string): string => {
        if (!key) return raw;
        try {
            const translated = key.includes(".") ? rootT(key) : t(key);
            return translated && translated !== key ? translated : raw;
        } catch {
            return raw;
        }
    };

    if (loading || sections.length === 0) return null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {sections.map((section) => (
                <Card key={section.id}>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <CardTitle className="text-base">{translateLabel(section.title, section.titleKey)}</CardTitle>
                            {section.viewAllHref && (
                                <Link href={section.viewAllHref} className="text-xs text-primary hover:underline">
                                    {t("dashboard_viewAll")}
                                </Link>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {section.items.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4 text-sm">{t("dashboard_noData")}</p>
                        ) : (
                            <div className="space-y-2">
                                {section.items.map((item) => {
                                    const content = (
                                        <div className="flex justify-between items-center p-3 rounded-lg hover:bg-muted/50 transition-colors text-sm">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{item.primary}</p>
                                                {item.secondary && <p className="text-xs text-muted-foreground">{item.secondary}</p>}
                                            </div>
                                            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                                                {item.value && <span className="font-bold text-sm">{item.value}</span>}
                                                {item.badge && (
                                                    <span className={badgeClassName(badgeTones[item.badgeColor || "gray"] ?? "neutral")}>
                                                        {translateLabel(item.badge, item.badgeKey)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                    return item.href ? (
                                        <Link key={item.id} href={item.href}>{content}</Link>
                                    ) : (
                                        <div key={item.id}>{content}</div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

