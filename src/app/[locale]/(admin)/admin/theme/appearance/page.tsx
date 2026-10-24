"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTheme } from "@/core/providers/theme-provider";
import * as Fields from "@/core/components/admin/theme-customizer/fields";
import { SuggestedModulesBanner } from "@/core/components/admin/theme/SuggestedModulesBanner";
import { writeError } from "@/core/lib/write-result";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { Link } from "@/core/lib/i18n/navigation";
import { colorLabelKey } from "@/core/lib/theme-labels";

/**
 * Active theme's appearance editor - color tokens + mode toggle.
 *
 * This page is scoped to whichever theme is currently active. The
 * multi-theme library (picker, install, delete) lives at
 * /admin/settings/theme; keeping the two concerns on separate pages
 * avoids the confusion of seeing other themes' cards while editing
 * your own.
 */
export default function ActiveThemeAppearancePage() {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const { activeTheme, currentMode, setMode } = useTheme();
    const { confirm } = useConfirm();
    const [colorOverrides, setColorOverrides] = useState<Record<string, string | undefined>>({});
    const [saving, setSaving] = useState(false);

    const themeId = activeTheme?.id;
    const colorTokens = activeTheme?.tokens?.colors ?? {};
    const modes = Object.keys(activeTheme?.modes?.available ?? {});

    // A theme's setting groups - "hero", "footer" - each have their own
    // screen. They were reachable only from the sidebar, so a reader who
    // landed on appearance had no way to see that the rest of the theme was
    // editable at all.
    const groups = Object.entries(activeTheme?.settings ?? {})
        .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));

    // Modes are theme-defined keys. The two every theme ships get a real
    // name; anything else a theme invents keeps its own.
    const modeLabel = (m: string) =>
        m === "light" ? t("theme_modeLight") : m === "dark" ? t("theme_modeDark") : m;

    useEffect(() => {
        let cancelled = false;
        if (!themeId) return;
        fetch(`/api/v1/themes/${themeId}/customization`)
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                const modeOverrides = data?.overrides?.[currentMode];
                const colors = (modeOverrides as { tokens?: { colors?: Record<string, string> } })?.tokens?.colors ?? {};
                setColorOverrides(colors);
            })
            .catch(() => {
                // Falling back to "no overrides" without saying so would show
                // the theme's own colours as if they were the saved ones, and
                // the next save would write that lie back.
                if (cancelled) return;
                setColorOverrides({});
                toast.error(commonT("loadFailed"));
            });
        return () => { cancelled = true; };
    }, [themeId, currentMode, commonT]);

    const saveColors = async () => {
        if (!themeId) return;
        setSaving(true);
        const nonEmpty = Object.fromEntries(Object.entries(colorOverrides).filter(([, v]) => v !== undefined));
        try {
            const res = await fetch(`/api/v1/themes/${themeId}/customization`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ mode: currentMode, overrides: { tokens: { colors: nonEmpty } } }),
            });
            if (!res.ok) { toast.error(t("theme_saveFailed")); return; }
            toast.success(t("theme_colorsSaved"));
        } catch {
            toast.error(t("theme_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const resetColors = async () => {
        if (!themeId) return;
        const ok = await confirm({
            title: t("theme_resetTitle"),
            message: t("theme_resetConfirm", { name: activeTheme?.name ?? "", mode: currentMode }),
            variant: "danger",
            confirmText: t("theme_reset"),
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/themes/${themeId}/customization`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: currentMode, overrides: {} }),
        });
        const failed = await writeError(res, t("common_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        setColorOverrides({});
        toast.success(t("theme_resetDone"));
    };

    const switchMode = async (m: string) => {
        if (!themeId) return;
        setMode(m);
        const res = await fetch("/api/v1/themes/state", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ themeId, mode: m }),
        });
        // The mode is applied locally either way; what a failure costs is the
        // memory of it, so the next visit opens on the old one.
        const failed = await writeError(res, t("common_writeFailed"), t);
        if (failed) toast.error(failed);
    };

    if (!activeTheme) {
        return (
            <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">{t("theme_noActive")}</CardContent>
            </Card>
        );
    }

    return (
        <>
            {/* No `p-6` and no `max-w-4xl`: the layout pads its own content,
                and the cap left the right half of every wide screen empty
                while the colour pickers sat two to a row. */}
            <AdminPageHeader
                title={`${activeTheme.name} - ${t("theme_appearanceTitle")}`}
                description={t("theme_appearanceSubtitle")}
                actions={Object.keys(colorTokens).length > 0 ? (
                    <>
                        <Button variant="outline" onClick={resetColors} disabled={saving}>
                            <RotateCcw className="w-4 h-4" />
                            {t("theme_resetDefault")}
                        </Button>
                        <Button onClick={saveColors} disabled={saving}>
                            <Check className="w-4 h-4" />
                            {saving ? t("theme_saving") : t("theme_saveColors")}
                        </Button>
                    </>
                ) : undefined}
            />

            <SuggestedModulesBanner
                themeName={activeTheme.name}
                suggestions={activeTheme.suggestedModules ?? []}
            />

            {/* `items-stretch` is the grid default, so both columns are as
                tall as the taller one; the right column lays its cards out
                in a flex column and lets the last one take the slack, which
                is what stops it ending a few pixels short of the swatches. */}
            <div className="grid grid-cols-1 gap-6 mt-6 xl:grid-cols-3">
                <div className="xl:col-span-2 space-y-6">
                    {Object.keys(colorTokens).length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">{t("theme_colors")}</CardTitle>
                                <CardDescription>{t("theme_overrideDesc")}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                    {Object.entries(colorTokens).map(([name, def]) => {
                                        const modeDefault = activeTheme.modes?.available?.[currentMode]?.tokens?.colors?.[name];
                                        const labelKey = colorLabelKey(name, def.labelKey);
                                        const effectiveDef = {
                                            ...def,
                                            label: t.has(labelKey) ? t(labelKey) : def.label ?? name,
                                            default: modeDefault ?? def.default,
                                        };
                                        return (
                                            <Fields.ColorField
                                                key={name}
                                                def={effectiveDef}
                                                value={colorOverrides[name]}
                                                onChange={(v) => setColorOverrides((prev) => ({ ...prev, [name]: v }))}
                                                isDefault={colorOverrides[name] === undefined}
                                            />
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                <div className="flex flex-col gap-6">
                    {modes.length > 1 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">{t("theme_mode")}</CardTitle>
                                <CardDescription>{t("theme_modeDesc")}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-2">
                                    {modes.map((m) => (
                                        <Button
                                            key={m}
                                            size="sm"
                                            variant={m === currentMode ? "default" : "outline"}
                                            onClick={() => switchMode(m)}
                                        >
                                            {m === currentMode && <Check className="w-3.5 h-3.5" />}
                                            {modeLabel(m)}
                                        </Button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {groups.length > 0 && (
                        <Card className="flex flex-col flex-1">
                            <CardHeader>
                                <CardTitle className="text-base">{t("theme_groups")}</CardTitle>
                                <CardDescription>{t("theme_groupsDesc")}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 space-y-1">
                                {groups.map(([key, group]) => (
                                    <Link
                                        key={key}
                                        href={`/admin/theme/${key}`}
                                        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                                    >
                                        {group.icon && <NavIcon name={group.icon} className="w-4 h-4 text-muted-foreground" />}
                                        <span className="flex-1 font-medium">{group.labelKey && t.has(group.labelKey) ? t(group.labelKey) : group.label}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {t("theme_groupFieldCount", { count: Object.keys(group.fields).length })}
                                        </span>
                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    </Link>
                                ))}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </>
    );
}
