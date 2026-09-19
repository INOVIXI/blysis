"use client";

import { useState, useEffect, useMemo } from "react";

import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Loader2, Check, Eye, EyeOff, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ModuleWidgets } from "@/core/generated/module-registry";
import { useAllModules } from "@/core/providers/module-provider";
import { useLocale, useTranslations } from "next-intl";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { isWidgetVisible } from "@/core/lib/homepage-widgets";
import { widgetLabel } from "@/core/lib/widget-label";
import { moduleName } from "@/core/lib/module-label";
import { writeError } from "@/core/lib/write-result";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";

export default function WidgetSettingsPage() {
    const modules = useAllModules();
    const t = useTranslations("admin");
    const locale = useLocale();

    // Build available widgets from registry, filtered to enabled modules
    const availableWidgets = useMemo(() =>
        ModuleWidgets
            .filter((w) => isEnabledIn(modules, w.module))
            .map((w) => ({
                id: w.id,
                name: widgetLabel(w, (key) => t.has(key), (key) => t(key)),
                // The module's name, not the directory it lives in.
                description: t("widgets_fromModule", { module: moduleName({ id: w.module }, locale, t) }),
                module: w.module,
                defaultVisible: w.defaultVisible,
            })),
        [modules, t, locale]
    );

    const [widgetConfig, setWidgetConfig] = useState<Record<string, boolean>>({});
    const [widgetOrder, setWidgetOrder] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
    // The list of widgets comes from the registry, so it renders either way -
    // but the visibility it renders comes from this request. A failed load
    // showed every widget at its default and let the admin save that back
    // over the settings they actually had.
    const [loadFailed, setLoadFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/settings")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((data) => {
                if (cancelled) return;
                const s = data.settings || {};
                const config = s.widget_visibility || {};
                const widgetIds = availableWidgets.map((w) => w.id);
                const order = s.widget_order || widgetIds;

                const vis: Record<string, boolean> = {};
                // Same rule the homepage applies, so an untouched widget
                // reads here exactly as it renders there.
                availableWidgets.forEach((w) => { vis[w.id] = isWidgetVisible(w, config); });
                setWidgetConfig(vis);
                setWidgetOrder(Array.isArray(order) ? order.filter((id: string) => widgetIds.includes(id)) : widgetIds);
                // Add any new widgets not in saved order
                const savedSet = new Set(Array.isArray(order) ? order : []);
                const missing = widgetIds.filter((id) => !savedSet.has(id));
                if (missing.length > 0) {
                    setWidgetOrder((prev) => [...prev, ...missing]);
                }
                setLoadFailed(false);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setLoadFailed(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [availableWidgets, reloadKey]);

    const toggle = (id: string) => {
        setWidgetConfig({ ...widgetConfig, [id]: !widgetConfig[id] });
    };

    const move = (id: string, dir: -1 | 1) => {
        const idx = widgetOrder.indexOf(id);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= widgetOrder.length) return;
        const newOrder = [...widgetOrder];
        [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
        setWidgetOrder(newOrder);
    };

    const handleDragStart = (idx: number) => {
        setDraggedIdx(idx);
    };

    const handleDragOver = (e: React.DragEvent, idx: number) => {
        e.preventDefault();
        setDragOverIdx(idx);
    };

    const handleDragLeave = () => {
        setDragOverIdx(null);
    };

    const handleDrop = (idx: number) => {
        if (draggedIdx === null || draggedIdx === idx) {
            setDraggedIdx(null);
            setDragOverIdx(null);
            return;
        }
        const newOrder = [...widgetOrder];
        const [moved] = newOrder.splice(draggedIdx, 1);
        newOrder.splice(idx, 0, moved);
        setWidgetOrder(newOrder);
        setDraggedIdx(null);
        setDragOverIdx(null);
    };

    const handleDragEnd = () => {
        setDraggedIdx(null);
        setDragOverIdx(null);
    };

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ widget_visibility: widgetConfig, widget_order: widgetOrder }),
            });
            const failed = await writeError(res, t("common_writeFailed"), t);
            if (failed) { toast.error(failed); return; }
            toast.success(t("widgets_saved"));
        } catch {
            toast.error(t("common_writeFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    const sortedWidgets = widgetOrder
        .map((id) => availableWidgets.find((w) => w.id === id))
        .filter(Boolean) as typeof availableWidgets;
    const allHidden = sortedWidgets.length > 0 && sortedWidgets.every((w) => !widgetConfig[w.id]);

    return (
        <>
            <AdminPageHeader
                title={t("widgets_title")}
                description={t("widgets_subtitle")}
                actions={sortedWidgets.length > 0 && !loadFailed ? (
                    <Button onClick={save} disabled={saving}>
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("widgets_saving")}</> : <><Check className="w-4 h-4" /> {t("widgets_save")}</>}
                    </Button>
                ) : undefined}
            />

            {/* Every widget switched off is a legitimate choice and an easy
                accident, and the homepage cannot tell you which it was: it
                just renders nothing where the sidebar used to be. */}
            {allHidden && (
                <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <p className="text-foreground">{t("widgets_allHidden")}</p>
                </div>
            )}

            {/* "It is on and it still is not there" is the question this
                screen could not answer: a widget decides for itself whether
                it has anything to render, and on a fresh install most of them
                do not. Saying so here is cheaper than every admin finding out
                by staring at an empty homepage. */}
            {!loadFailed && sortedWidgets.length > 0 && (
                <p className="mb-6 text-sm text-muted-foreground">{t("widgets_needsContent")}</p>
            )}

            {loadFailed ? (
                <Card className="mb-6">
                    <CardContent>
                        <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                    </CardContent>
                </Card>
            ) : sortedWidgets.length === 0 ? (
                <Card className="mb-6 border-dashed">
                    <CardContent className="py-12 text-center">
                        <p className="text-muted-foreground">{t("widgets_none")}</p>
                    </CardContent>
                </Card>
            ) : (
            <Card className="mb-6">
                <CardContent className="p-0">
                    <div className="divide-y">
                        {sortedWidgets.map((widget, idx) => (
                            <div
                                key={widget.id}
                                draggable
                                onDragStart={() => handleDragStart(idx)}
                                onDragOver={(e) => handleDragOver(e, idx)}
                                onDragLeave={handleDragLeave}
                                onDrop={() => handleDrop(idx)}
                                onDragEnd={handleDragEnd}
                                className={`flex items-center gap-4 p-4 transition-all ${draggedIdx === idx ? "opacity-40" : ""} ${dragOverIdx === idx && draggedIdx !== idx ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                            >
                                <div className="flex flex-col gap-0.5 cursor-grab active:cursor-grabbing">
                                    <button type="button" aria-label={t("common_moveUp", { label: widget.name })} onClick={() => move(widget.id, -1)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"><ChevronUp className="h-4 w-4" /></button>
                                    <button type="button" aria-label={t("common_moveDown", { label: widget.name })} onClick={() => move(widget.id, 1)} disabled={idx === sortedWidgets.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"><ChevronDown className="h-4 w-4" /></button>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium">{widget.name}</p>
                                    <p className="text-xs text-muted-foreground">{widget.description}</p>
                                </div>
                                <Button
                                    variant={widgetConfig[widget.id] ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => toggle(widget.id)}
                                >
                                    {widgetConfig[widget.id] ? <><Eye className="w-3 h-3" /> {t("widgets_visible")}</> : <><EyeOff className="w-3 h-3" /> {t("widgets_hidden")}</>}
                                </Button>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            )}
        </>
    );
}
