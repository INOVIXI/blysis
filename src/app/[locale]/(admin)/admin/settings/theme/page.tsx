"use client";

import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Check, Upload, Loader2, Trash2, AlertTriangle, Palette, Download, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTranslations } from "next-intl";

import { themeRegistry } from "@/core/generated/theme-registry";
import { useTheme } from "@/core/providers/theme-provider";
import { SuggestedModulesBanner } from "@/core/components/admin/theme/SuggestedModulesBanner";
import { writeError, errorMessage } from "@/core/lib/write-result";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { readJson } from "@/core/lib/read-json";

export default function ThemeSettingsPage() {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    // currentMode is only used by handleThemeSwitch below; color customization
    // itself moved to /admin/theme/appearance so this page no longer loads or
    // mutates ThemeCustomization rows.
    const { activeTheme, currentThemeId, currentMode, setMode } = useTheme();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const { confirm } = useConfirm();

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setUploadMessage(null);

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/api/v1/themes/upload", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();

            if (!res.ok) {
                const errorMsg = data.details
                    ? `${data.error}: ${data.details.join(", ")}`
                    : data.error;
                setUploadMessage({ type: "error", text: errorMsg });
                return;
            }

            setUploadMessage({ type: "success", text: data.message });
        } catch {
            setUploadMessage({ type: "error", text: "Upload failed" });
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleDelete = async (themeId: string) => {
        const ok = await confirm({ title: t("theme_deleteTitle"), message: t("theme_deleteConfirm", { name: themeId }), variant: "danger", confirmText: t("common_delete") });
        if (!ok) return;

        setDeleting(themeId);
        try {
            const res = await fetch(`/api/v1/themes/${themeId}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) {
                toast.error(errorMessage(data, t("theme_deleteFailed"), t));
            } else {
                setUploadMessage({ type: "success", text: data.message });
            }
        } catch {
            toast.error(t("theme_deleteFailed"));
        } finally {
            setDeleting(null);
        }
    };

    const handleThemeSwitch = async (themeId: string) => {
        const res = await fetch("/api/v1/themes/state", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ themeId, mode: currentMode }),
        });
        const failed = await writeError(res, t("common_writeFailed"), t);
        // Reloading on a failed switch would repaint the page in the theme it
        // already had and look like the click did nothing.
        if (failed) { toast.error(failed); return; }
        location.reload();
    };

    const renderPreview = (themeId: string) => {
        const theme = themeRegistry[themeId];
        if (!theme) return null;
        // v2: per-mode color defaults live in modes.available[mode].tokens.colors.
        // Pick the theme's default mode so each card shows its intended palette.
        const modeKey = theme.modes?.default;
        const modeColorsRaw = modeKey ? theme.modes?.available?.[modeKey]?.tokens?.colors : undefined;
        const modeColors: Record<string, string> = modeColorsRaw && typeof modeColorsRaw === "object"
            ? (modeColorsRaw as Record<string, string>)
            : {};
        const tokenDefs = theme.tokens?.colors ?? {};
        const colorFor = (k: string): string => {
            const fromMode = modeColors[k];
            if (typeof fromMode === "string") return fromMode;
            const def = tokenDefs[k];
            return def && "default" in def && typeof def.default === "string" ? def.default : "#000";
        };
        const colors = {
            background: colorFor("background"),
            border: colorFor("border"),
            muted: colorFor("muted"),
            destructive: colorFor("destructive"),
            warning: colorFor("warning"),
            success: colorFor("success"),
            primary: colorFor("primary"),
            secondary: colorFor("secondary"),
        };

        return (
            <div className="w-full h-32 rounded-md mb-4 relative overflow-hidden border border-border" style={{ background: colors.background }}>
                <div className="absolute top-0 left-0 w-full h-8 border-b flex items-center px-2 space-x-2" style={{ borderColor: colors.border, background: colors.muted }}>
                    <div className="w-3 h-3 rounded-full" style={{ background: colors.destructive }} />
                    <div className="w-3 h-3 rounded-full" style={{ background: colors.warning }} />
                    <div className="w-3 h-3 rounded-full" style={{ background: colors.success }} />
                </div>
                <div className="p-4 mt-8 space-y-2">
                    <div className="h-4 w-3/4 rounded" style={{ background: colors.primary, opacity: 0.2 }} />
                    <div className="h-4 w-1/2 rounded" style={{ background: colors.primary, opacity: 0.1 }} />
                    <div className="flex space-x-2 mt-4">
                        <div className="h-8 px-4 rounded flex items-center text-xs font-bold" style={{ background: colors.primary, color: '#fff' }}>
                            {t("theme_previewPrimary")}
                        </div>
                        <div className="h-8 px-4 rounded flex items-center text-xs font-bold" style={{ background: colors.secondary, color: '#fff' }}>
                            {t("theme_previewSecondary")}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Built-in themes ship in-tree - every key in the generated registry.
    const builtInThemes = Object.keys(themeRegistry);

    // Marketplace
    const [marketplaceThemes, setMarketplaceThemes] = useState<{ id: string; name: string; version: string; type: string; description: string; verified: boolean; zip: string; colors?: Record<string, string> }[]>([]);
    const [loadingMarketplace, setLoadingMarketplace] = useState(true);
    const [installing, setInstalling] = useState<string | null>(null);

    // A failed read used to render an empty marketplace, which reads as "there
    // are no themes to install" rather than "the list did not load".
    const [marketplaceFailed, setMarketplaceFailed] = useState(false);
    const [marketplaceAttempt, setMarketplaceAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoadingMarketplace(true);
        setMarketplaceFailed(false);
        fetch("/api/v1/themes/marketplace")
            .then(readJson<{ themes?: typeof marketplaceThemes }>)
            .then(d => {
                if (cancelled) return;
                setMarketplaceThemes(d.themes || []);
                setLoadingMarketplace(false);
            })
            .catch(() => {
                if (cancelled) return;
                setMarketplaceFailed(true);
                setLoadingMarketplace(false);
            });
        return () => { cancelled = true; };
    }, [marketplaceAttempt]);

    const installedThemeIds = new Set(Object.keys(themeRegistry));

    const handleMarketplaceInstall = async (theme: { id: string; name: string; zip: string }) => {
        setInstalling(theme.id);
        try {
            const res = await fetch("/api/v1/themes/marketplace/install", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ themeId: theme.id, zipFile: theme.zip }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(t("theme_installedRestart", { name: theme.name }));
            } else {
                toast.error(errorMessage(data, t("theme_installFailed"), t));
            }
        } catch { toast.error(t("theme_installFailed")); }
        finally { setInstalling(null); }
    };

    // Mode toggle
    const modes = Object.keys(activeTheme?.modes?.available ?? {});

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title={t("settings_appearance")}
                description={t("theme_subtitle")}
                actions={<>
                    <div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".zip"
                            onChange={handleUpload}
                            aria-label={t("theme_upload")}
                            className="hidden"
                        />
                        <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                        >
                            {uploading ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> {t("theme_uploading")}</>
                            ) : (
                                <><Upload className="w-4 h-4" /> {t("theme_upload")}</>
                            )}
                        </Button>
                    </div>
                </>}
            />

            {/* Suggested modules banner */}
            <SuggestedModulesBanner
                themeName={activeTheme?.name ?? ""}
                suggestions={activeTheme?.suggestedModules ?? []}
            />

            {uploadMessage && (
                <div className={`p-4 rounded-lg border text-sm ${
                    uploadMessage.type === "success"
                        ? "bg-success/10 text-success border-success/25"
                        : "bg-destructive/10 text-destructive border-destructive/25"
                }`}>
                    {uploadMessage.type === "error" && <AlertTriangle className="w-4 h-4 inline mr-2" />}
                    {uploadMessage.text}
                </div>
            )}

            {/* Mode toggle - only visible when there is more than one mode */}
            {modes.length > 1 && (
                <div className="flex gap-2">
                    {modes.map(m => (
                        <Button
                            key={m}
                            variant={m === currentMode ? "default" : "outline"}
                            onClick={async () => {
                                setMode(m);
                                const res = await fetch("/api/v1/themes/state", {
                                    method: "PUT",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ themeId: activeTheme?.id, mode: m }),
                                });
                                const failed = await writeError(res, t("common_writeFailed"), t);
                                if (failed) toast.error(failed);
                            }}
                        >
                            {m}
                        </Button>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.entries(themeRegistry).map(([id, theme]) => {
                    const isActive = currentThemeId === id;
                    const isBuiltIn = builtInThemes.includes(id);

                    return (
                        <Card
                            key={id}
                            className={`cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 ${isActive ? 'ring-2 ring-primary border-primary' : ''}`}
                            onClick={() => handleThemeSwitch(id)}
                        >
                            <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-base flex justify-between items-center">
                                    <span>{theme.name}</span>
                                    <div className="flex items-center gap-2">
                                        {isActive && <Check className="h-4 w-4 text-primary" />}
                                        {!isBuiltIn && (
                                            <button
                                                aria-label={commonT("delete")}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(id);
                                                }}
                                                className="text-muted-foreground hover:text-destructive transition-colors"
                                                disabled={deleting === id}
                                            >
                                                {deleting === id
                                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                                    : <Trash2 className="w-3 h-3" />
                                                }
                                            </button>
                                        )}
                                    </div>
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    {theme.description}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-4 pt-2">
                                {renderPreview(id)}
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>v{theme.version || '1.0.0'}</span>
                                    <div className="flex items-center gap-2">
                                        {!isBuiltIn && <span className="text-primary">{t("theme_custom")}</span>}
                                        <span>{theme.modes?.default ?? "-"}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Theme Marketplace */}
            {marketplaceFailed && (
                <Card>
                    <CardContent>
                        <LoadFailed onRetry={() => setMarketplaceAttempt((a) => a + 1)} />
                    </CardContent>
                </Card>
            )}

            {(() => {
                const available = marketplaceThemes.filter(th => !installedThemeIds.has(th.id));
                if (loadingMarketplace || marketplaceFailed || available.length === 0) return null;
                return (
                    <div>
                        <h2 className="text-lg font-medium flex items-center gap-2 mb-4">
                            <CheckCircle className="w-5 h-5 text-primary" />
                            {t("theme_verified")}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {available.map((theme: { id: string; name: string; version: string; type: string; description: string; verified: boolean; zip: string; colors?: Record<string, string> }) => (
                                <Card key={theme.id} className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: theme.colors?.primary || "#333" }}>
                                                <Palette className="w-5 h-5 text-white" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-sm flex items-center gap-1.5">
                                                    {theme.name}
                                                    {theme.verified && <CheckCircle className="w-3.5 h-3.5 text-primary" />}
                                                </h3>
                                                <p className="text-xs text-muted-foreground">v{theme.version} - {theme.type}</p>
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground mb-3">{theme.description}</p>
                                        {theme.colors && (
                                            <div className="flex gap-1 mb-3">
                                                {Object.values(theme.colors).map((c: string, i: number) => (
                                                    <div key={i} className="w-6 h-6 rounded" style={{ background: c }} />
                                                ))}
                                            </div>
                                        )}
                                        <Button size="sm" className="w-full" disabled={installing === theme.id} onClick={() => handleMarketplaceInstall(theme)}>
                                            {installing === theme.id ? <><Loader2 className="w-3 h-3 animate-spin .5" /> {t("modules_installing")}</> : <><Download className="w-3 h-3 .5" /> {t("modules_install")}</>}
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                );
            })()}

            <div className="rounded-md border border-primary/25 bg-primary/10 p-4 text-sm text-foreground">
                <strong>{t("theme_libraryNoticeTitle")}</strong>{" "}
                {/* A tag, not an argument. `t.rich` types an argument as a
                    string, a number or a date, so a node can only reach the
                    sentence by wrapping text the message already carries -
                    and an argument handed a function is rendered as one. */}
                {t.rich("theme_libraryNoticeBody", {
                    path: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
                })}
            </div>

            <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                    <strong>{t("theme_uploadLabel")}</strong> {t("theme_uploadHint")} <code className="text-xs bg-background px-1 rounded">theme.json</code> with theme configuration (id, name, colors, fonts).
                    Optionally include a <code className="text-xs bg-background px-1 rounded">components/</code> folder with TSX overrides.
                    After uploading, restart the server to activate the theme.
                </p>
            </div>
        </div>
    );
}
