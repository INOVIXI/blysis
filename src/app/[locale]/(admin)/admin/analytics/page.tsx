"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Loader2 } from "lucide-react";
import { useAllModules } from "@/core/providers/module-provider";
import { Link } from "@/core/lib/i18n/navigation";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Filler,
    Tooltip,
    Legend,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { ALL_TAB, analyticsTabs, type TabDeclaration } from "@/core/lib/analytics-tabs";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { dateLocaleTag } from "@/core/lib/utils";
import { useSiteCurrency } from "@/core/components/currency/site-currency";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { SegmentedTabs } from "@/core/components/ui/segmented-tabs";

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Filler,
    Tooltip,
    Legend,
);

/**
 * What a module may ask this screen to draw.
 *
 * Core owns the chart types; a module picks one. That is the same bargain as
 * the rest of the platform - the module declares, core renders - and it is the
 * reason a module cannot ship a chart that looks nothing like the panel.
 *
 *   `area`  (default) a filled trend line. Volume over time.
 *   `line`  the same trend without the fill. Better when two series would
 *           otherwise stack into mud, and for rates rather than volumes.
 *   `bar`   discrete counts. A comparison between days rather than a curve
 *           through them, which is what a count of orders per day really is.
 *
 * A ranking is not a chart. "Which five products earned the most" has no time
 * axis, and drawing it as one is how a leaderboard ends up as a sawtooth
 * nobody can read, so it gets its own panel type.
 */
type ChartKind = "line" | "area" | "bar";

interface ChartSeries {
    id: string;
    label: string;
    labelKey?: string;
    labels: string[];
    data: number[];
    color?: string;
    type?: ChartKind;
    format?: "currency" | "number";
    source?: string;
    /** The tab its module filed it under. Unknown groups stay under All. */
    group?: string;
}

interface RankingItem {
    id: string;
    label: string;
    value: number;
    secondary?: string;
    href?: string;
}

interface RankingSeries {
    id: string;
    label: string;
    labelKey?: string;
    items: RankingItem[];
    color?: string;
    format?: "currency" | "number";
    source?: string;
    group?: string;
}

interface CoreStatsResponse {
    labels: string[];
    users: number[];
    totals: { users: number };
}

interface ModuleManifest {
    id: string;
    statsApi?: string;
}

const PERIODS = [
    { key: "7", labelKey: "analytics_period_7" },
    { key: "30", labelKey: "analytics_period_30" },
    { key: "90", labelKey: "analytics_period_90" },
    { key: "365", labelKey: "analytics_period_365" },
];

function sum(data: number[]): number {
    return data.reduce((a, b) => a + b, 0);
}

function formatTotal(
    total: number,
    fmt: string | undefined,
    localeTag: string,
    money: (amount: number | string | null | undefined) => string,
): string {
    if (fmt === "currency") return money(total);
    if (Number.isInteger(total)) return total.toLocaleString(localeTag);
    return total.toFixed(2);
}

export default function AnalyticsPage() {
    const __locale = useLocale();
    const __dateTag = dateLocaleTag(__locale);
    const { format: money } = useSiteCurrency();
    const t = useTranslations("admin");
    const moduleStates = useAllModules();
    const [period, setPeriod] = useState<string>("30");
    const [charts, setCharts] = useState<ChartSeries[]>([]);
    const [rankings, setRankings] = useState<RankingSeries[]>([]);
    const [declaredTabs, setDeclaredTabs] = useState<TabDeclaration[]>([]);
    const [openTab, setOpenTab] = useState<string>(ALL_TAB);
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const collected: ChartSeries[] = [];
        const collectedRankings: RankingSeries[] = [];
        const collectedTabs: TabDeclaration[] = [];
        try {

            // Core users chart
            try {
                const res = await fetch(`/api/v1/stats?period=${period}d`);
                if (res.ok) {
                    const d: CoreStatsResponse = await res.json();
                    if (d.labels?.length && d.users?.length) {
                        collected.push({
                            id: "core-users",
                            label: "New users per day",
                            labelKey: "analytics_newUsersPerDay",
                            labels: d.labels,
                            data: d.users,
                            color: "#6366f1",
                            source: "core",
                        });
                    }
                }
            } catch { /* skip */ }

            // Module charts
            try {
                const res = await fetch("/api/v1/modules");
                if (res.ok) {
                    const data = await res.json();
                    const enabledModules = ((data.modules || []) as ModuleManifest[])
                        .filter((m) => isEnabledIn(moduleStates, m.id) && !!m.statsApi);

                    const fetches = enabledModules.map(async (m) => {
                        try {
                            const url = `/api/v1${m.statsApi}?period=${period}`;
                            const r = await fetch(url);
                            if (!r.ok) return;
                            const body = await r.json();
                            if (Array.isArray(body.charts)) {
                                for (const c of body.charts) {
                                    collected.push({ ...c, source: m.id });
                                }
                            }
                            if (Array.isArray(body.rankings)) {
                                for (const r of body.rankings) {
                                    if (Array.isArray(r?.items)) {
                                        collectedRankings.push({ ...r, source: m.id });
                                    }
                                }
                            }
                            if (Array.isArray(body.tabs)) {
                                for (const tab of body.tabs) {
                                    if (tab?.id && tab?.label) collectedTabs.push(tab);
                                }
                            }
                        } catch { /* skip */ }
                    });
                    await Promise.all(fetches);
                }
            } catch { /* skip */ }

            setCharts(collected);
            setRankings(collectedRankings);
            setDeclaredTabs(collectedTabs);
            // In a `finally` rather than trailing the body: it reads as
            // unconditional only if you have checked that every `try` above it
            // still has a `catch`, and a spinner that never stops is not a thing
            // to leave resting on that.
        } finally {
            setLoading(false);
        }
    }, [period, moduleStates]);

    useEffect(() => {
        void fetchAll();
    }, [fetchAll]);

    const tabs = analyticsTabs(declaredTabs, charts, rankings);
    // A tab can vanish when the period changes and its module returns nothing
    // for the new window, which would otherwise leave the screen showing a tab
    // nobody can see and no panels at all.
    const shown = tabs.find((tab) => tab.id === openTab) ?? tabs[0];

    const translateLabel = (raw: string, key?: string): string => {
        if (!key) return raw;
        try {
            const tx = t(key);
            return tx && tx !== key ? tx : raw;
        } catch {
            return raw;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <AdminPageHeader
                title={t("analytics_title")}
                description={t("analytics_description")}
                actions={<>
                    {/*
                      * A filter chip group, not a toolbar of boxes. `rounded` on a
                      * button inside a `rounded-lg` strip left four square corners
                      * on the selected period and four more on hover.
                      */}
                    <div
                        role="group"
                        aria-label={t("analytics_periodLabel")}
                        className="flex gap-1 rounded-full border border-border p-1 bg-card"
                    >
                        {PERIODS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => setPeriod(p.key)}
                                aria-pressed={period === p.key}
                                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                    period === p.key
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                }`}
                            >
                                {t(p.labelKey as "analytics_period_30")}
                            </button>
                        ))}
                    </div>
                </>}
            />

            {/* One tab is not a choice, so the strip appears only once a
                module has filled a second one. */}
            {!loading && tabs.length > 1 && (
                <SegmentedTabs
                    label={t("analytics_reports")}
                    activeId={shown.id}
                    onChange={setOpenTab}
                    tabs={tabs.map((tab) => ({
                        id: tab.id,
                        label: tab.id === ALL_TAB
                            ? t("analytics_tabAll")
                            : translateLabel(tab.label ?? tab.id, tab.labelKey ?? undefined),
                    }))}
                />
            )}

            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t("analytics_loading")}
                    </div>
                </div>
            ) : shown.charts.length === 0 && shown.rankings.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground text-sm">
                        {t("analytics_noCharts")}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {shown.charts.map((chart) => {
                        const color = chart.color ?? "#6366f1";
                        const total = sum(chart.data);
                        const kind: ChartKind = chart.type ?? "area";
                        const title = translateLabel(chart.label, chart.labelKey);
                        const dataset = {
                            label: title,
                            data: chart.data,
                            borderColor: color,
                            backgroundColor: kind === "bar" ? color + "cc" : color + "22",
                            fill: kind === "area",
                            tension: 0.35,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            borderWidth: kind === "bar" ? 0 : 2,
                            borderRadius: kind === "bar" ? 4 : undefined,
                            hoverBackgroundColor: kind === "bar" ? color : undefined,
                            maxBarThickness: 28,
                        };
                        // `pointRadius: 0` with Chart.js's default `intersect`
                        // means the pointer has to land on an invisible point,
                        // so hovering the chart showed nothing at all. Index
                        // mode reads the nearest column instead, which is what
                        // "what was it on this day" asks for.
                        const options = {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: "index" as const, intersect: false },
                            hover: { mode: "index" as const, intersect: false },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    displayColors: false,
                                    padding: 10,
                                    callbacks: {
                                        label: (ctx: { parsed: { y: number | null } }) => {
                                            const v = ctx.parsed.y ?? 0;
                                            if (chart.format === "currency") return money(v);
                                            return `${title}: ${v.toLocaleString(__dateTag)}`;
                                        },
                                    },
                                },
                            },
                            scales: {
                                x: {
                                    display: true,
                                    ticks: {
                                        maxTicksLimit: 6,
                                        color: "rgb(var(--muted-foreground-rgb, 120 120 120) / 1)",
                                        font: { size: 10 },
                                    },
                                    grid: { display: false },
                                },
                                y: {
                                    display: true,
                                    beginAtZero: true,
                                    ticks: {
                                        maxTicksLimit: 5,
                                        color: "rgb(var(--muted-foreground-rgb, 120 120 120) / 1)",
                                        font: { size: 10 },
                                    },
                                    grid: { color: "rgba(150, 150, 150, 0.1)" },
                                },
                            },
                        };
                        return (
                            <Card key={chart.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between gap-3">
                                        <CardTitle className="text-sm">{title}</CardTitle>
                                        <div className="text-right">
                                            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
                                                {t("analytics_total")}
                                            </div>
                                            <div className="text-lg font-bold" style={{ color }}>
                                                {formatTotal(total, chart.format, __dateTag, money)}
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-48">
                                        {kind === "bar" ? (
                                            <Bar data={{ labels: chart.labels, datasets: [dataset] }} options={options} />
                                        ) : (
                                            <Line data={{ labels: chart.labels, datasets: [dataset] }} options={options} />
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}

                    {shown.rankings.map((ranking) => {
                        const color = ranking.color ?? "#6366f1";
                        const top = ranking.items.slice(0, 8);
                        const peak = Math.max(...top.map((item) => item.value), 0);
                        return (
                            <Card key={ranking.id}>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm">
                                        {translateLabel(ranking.label, ranking.labelKey)}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {top.length === 0 ? (
                                        <p className="py-12 text-center text-sm text-muted-foreground">
                                            {t("analytics_noData")}
                                        </p>
                                    ) : (
                                        <ol className="space-y-2">
                                            {top.map((item, index) => {
                                                const row = (
                                                    <div className="flex items-center gap-3">
                                                        <span className="w-5 shrink-0 text-xs font-mono text-muted-foreground">
                                                            {index + 1}
                                                        </span>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-baseline justify-between gap-2">
                                                                <span className="truncate text-sm">{item.label}</span>
                                                                <span className="shrink-0 text-sm font-semibold tabular-nums">
                                                                    {formatTotal(item.value, ranking.format, __dateTag, money)}
                                                                </span>
                                                            </div>
                                                            {/* The bar carries the comparison the number alone does not. */}
                                                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full"
                                                                    style={{
                                                                        width: peak > 0 ? `${Math.max(2, (item.value / peak) * 100)}%` : "0%",
                                                                        backgroundColor: color,
                                                                    }}
                                                                />
                                                            </div>
                                                            {item.secondary && (
                                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                                    {item.secondary}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                                return (
                                                    <li key={item.id}>
                                                        {item.href ? (
                                                            <Link href={item.href} className="block rounded-lg p-1 -m-1 hover:bg-muted/60 transition-colors">
                                                                {row}
                                                            </Link>
                                                        ) : (
                                                            row
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ol>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
