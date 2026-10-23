"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Loader2, Zap, Layers, Cpu } from "lucide-react";
import { badgeClassName } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";

interface DevData {
    hooks: {
        actions: { name: string; count: number; modules: string[] }[];
        filters: { name: string; count: number; modules: string[] }[];
        registered: { hook: string; type: string; module: string; priority?: number }[];
    };
    registries: {
        slotContents: unknown[];
        contextProviders: unknown[];
        navbarComponents: unknown[];
        footerComponents: unknown[];
        layoutComponents: unknown[];
        widgets: unknown[];
        profileTabs: unknown[];
        homepageSections: unknown[];
        settingsCards: unknown[];
        dashboardCards: unknown[];
    };
    runtime: {
        nodeVersion: string;
        uptime: number;
        memory: {
            rss: number;
            heapTotal: number;
            heapUsed: number;
            external: number;
        };
        env: string;
    };
}

function formatBytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

export default function DevToolsPage() {
    const t = useTranslations("admin");
    const [data, setData] = useState<DevData | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"hooks" | "registries" | "runtime">("hooks");

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/dev");
            const d = await res.json();
            setData(d);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    if (loading || !data) {
        return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <>
            <AdminPageHeader
                title={t("dev_title")}
                description={t("dev_subtitle")}
            />

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-border">
                {([
                    { id: "hooks", label: "Hooks", icon: Zap },
                    { id: "registries", label: "Registries", icon: Layers },
                    { id: "runtime", label: "Runtime", icon: Cpu },
                ] as const).map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            tab === t.id ? "text-foreground border-primary" : "text-muted-foreground border-transparent hover:text-foreground"
                        }`}
                    >
                        <t.icon className="w-4 h-4" />
                        {t.label}
                    </button>
                ))}
                <button onClick={fetchData} className="ml-auto text-xs text-muted-foreground hover:text-foreground self-center">
                    {t("system_refresh")}
                </button>
            </div>

            {/* Tab content */}
            {tab === "hooks" && (
                <div className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle className="text-base">{t("dev_registeredListeners", { count: data.hooks.registered.length })}</CardTitle></CardHeader>
                        <CardContent>
                            {data.hooks.registered.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t("dev_noListeners")}</p>
                            ) : (
                                <div className="space-y-1">
                                    {data.hooks.registered.map((l, i) => (
                                        <div key={i} className="flex items-center gap-3 text-sm py-1">
                                            <span className={badgeClassName(l.type === "action" ? "info" : "neutral", "font-mono uppercase")}>
                                                {l.type}
                                            </span>
                                            <code className="font-mono text-xs text-foreground">{l.hook}</code>
                                            <span className="text-xs text-muted-foreground">→ {l.module}</span>
                                            {l.priority !== undefined && <span className="text-xs text-muted-foreground">[{l.priority}]</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle className="text-base">{t("dev_activeActions", { count: data.hooks.actions.length })}</CardTitle></CardHeader>
                        <CardContent>
                            {data.hooks.actions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t("dev_noActions")}</p>
                            ) : (
                                <div className="space-y-1">
                                    {data.hooks.actions.map((a) => (
                                        <div key={a.name} className="flex items-center gap-3 text-sm py-1">
                                            <code className="font-mono text-xs">{a.name}</code>
                                            <span className="text-xs text-muted-foreground">{a.count} listener{a.count !== 1 ? "s" : ""}</span>
                                            <span className="text-xs text-muted-foreground">- {a.modules.join(", ")}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle className="text-base">{t("dev_activeFilters", { count: data.hooks.filters.length })}</CardTitle></CardHeader>
                        <CardContent>
                            {data.hooks.filters.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t("dev_noFilters")}</p>
                            ) : (
                                <div className="space-y-1">
                                    {data.hooks.filters.map((f) => (
                                        <div key={f.name} className="flex items-center gap-3 text-sm py-1">
                                            <code className="font-mono text-xs">{f.name}</code>
                                            <span className="text-xs text-muted-foreground">{f.count} listener{f.count !== 1 ? "s" : ""}</span>
                                            <span className="text-xs text-muted-foreground">- {f.modules.join(", ")}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {tab === "registries" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(data.registries).map(([key, items]) => (
                        <Card key={key}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-mono">{key}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-2xl font-bold text-foreground">{items.length}</p>
                                <details className="mt-2">
                                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                        {t("dev_viewEntries")}
                                    </summary>
                                    <pre className="text-[10px] mt-2 max-h-48 overflow-auto bg-muted p-2 rounded">
                                        {JSON.stringify(items, null, 2)}
                                    </pre>
                                </details>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {tab === "runtime" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader><CardTitle className="text-base">{t("dev_process")}</CardTitle></CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">{t("dev_nodeVersion")}</span><code>{data.runtime.nodeVersion}</code></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{t("dev_environment")}</span><code>{data.runtime.env}</code></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{t("system_uptime")}</span><code>{formatUptime(data.runtime.uptime)}</code></div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle className="text-base">{t("dev_memory")}</CardTitle></CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">RSS</span><code>{formatBytes(data.runtime.memory.rss)}</code></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{t("dev_heapUsed")}</span><code>{formatBytes(data.runtime.memory.heapUsed)}</code></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{t("dev_heapTotal")}</span><code>{formatBytes(data.runtime.memory.heapTotal)}</code></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">{t("dev_external")}</span><code>{formatBytes(data.runtime.memory.external)}</code></div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </>
    );
}
