"use client";

import { use, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { buttonClassName } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { Link } from "@/core/lib/i18n/navigation";
import { ModuleIcon } from "../ModuleIcon";
import { ModuleSettingsPanel } from "../ModuleSettingsPanel";
import { moduleDescription, moduleName } from "@/core/lib/module-label";
import type { Module, ModuleSettingValues } from "../types";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { errorMessage } from "@/core/lib/write-result";

/**
 * One module's settings, on its own screen.
 *
 * The form used to be folded into the module's card on /admin/modules, which
 * is the marketplace: a screen for finding, installing and enabling things.
 * Configuring a module there made every card a different height, buried the
 * install controls under a form, and left the settings of eleven modules
 * competing for the same page. A module's configuration is a place, so it
 * gets an address.
 */
export default function ModuleSettingsPage({
    params,
}: {
    params: Promise<{ moduleId: string }>;
}) {
    const { moduleId } = use(params);
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const locale = useLocale();

    const [mod, setMod] = useState<Module | null>(null);
    const [loading, setLoading] = useState(true);
    // A failed read left `mod` null and put the screen on "this module is not
    // installed", which is a different thing from "the list did not load".
    const [loadFailed, setLoadFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        // The reader can be on another module's settings before this answers.
        let cancelled = false;
        setLoadFailed(false);
        fetch("/api/v1/modules")
            .then((r) => {
                if (!r.ok) throw new Error("load failed");
                return r.json();
            })
            .then((data) => {
                if (cancelled) return;
                setMod((data.modules || []).find((m: Module) => m.id === moduleId) ?? null);
            })
            .catch(() => {
                if (cancelled) return;
                setLoadFailed(true);
                toast.error(t("modules_networkError"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [moduleId, t, reloadKey]);

    const save = async (id: string, config: ModuleSettingValues) => {
        try {
            const res = await fetch("/api/v1/modules", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ moduleId: id, enabled: mod?.enabled ?? true, config }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(errorMessage(data, t("modules_settingsFailed"), t));
                return false;
            }
            setMod((current) => (current ? { ...current, config } : current));
            toast.success(t("modules_settingsSaved"));
            return true;
        } catch {
            toast.error(t("modules_networkError"));
            return false;
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (loadFailed) {
        return (
            <Card>
                <CardContent><LoadFailed onRetry={() => setReloadKey((k) => k + 1)} /></CardContent>
            </Card>
        );
    }

    if (!mod) {
        return (
            <Card>
                <CardContent className="py-12 text-center space-y-3">
                    <p className="text-muted-foreground">{t("modules_notInstalled")}</p>
                    <Link href="/admin/modules" className={buttonClassName("outline", "sm")}>
                            <ArrowLeft className="w-4 h-4" />
                            {commonT("back")}
                        </Link>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <AdminPageHeader
                backHref="/admin/modules"
                backLabel={commonT("back")}
                title={
                    <span className="inline-flex items-center gap-2">
                        <span className="text-primary"><ModuleIcon name={mod.icon} /></span>
                        {moduleName(mod, locale, t)}
                    </span>
                }
                description={moduleDescription(mod, locale, t)}
            />

            <Card>
                <CardContent className="p-6">
                    {(mod.settings ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("modules_noSettings")}</p>
                    ) : (
                        <ModuleSettingsPanel module={mod} onSave={save} />
                    )}
                </CardContent>
            </Card>
        </>
    );
}
