"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Button } from "@/core/components/ui/button";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { Waiting } from "@/core/components/ui/waiting";
import { errorMessage } from "@/core/lib/write-result";
import { AiProviderCard } from "./AiProviderCard";
import { AiLimitsCard } from "./AiLimitsCard";
import { AiPurposesCard, AiUsageCard } from "./AiActivityCards";
import type { AiDraft, AiScreen } from "./ai-screen-data";

function draftFrom(screen: AiScreen): AiDraft {
    // A choice naming a provider that is no longer installed is no choice:
    // saving it back would be refused.
    const chosen = screen.providers.some((p) => p.id === screen.chosen) ? screen.chosen : null;
    return { ...screen.settings, active: chosen };
}

export default function AiSettingsPage() {
    const t = useTranslations("admin");
    const [screen, setScreen] = useState<AiScreen | null>(null);
    const [draft, setDraft] = useState<AiDraft | null>(null);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const res = await fetch("/api/v1/admin/ai");
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as AiScreen;
            setScreen(data);
            setDraft(draftFrom(data));
        } catch {
            setFailed(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const modules = useMemo(() => {
        if (!screen || !draft) return [];
        const ids = new Set([...screen.purposes.map((p) => p.module), ...Object.keys(draft.moduleTokenLimits)]);
        return [...ids].sort();
    }, [screen, draft]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft) return;
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/ai", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(draft),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                toast.error(errorMessage(body, t("ai_saveError"), t));
                return;
            }
            toast.success(t("ai_saved"));
            await load();
        } catch {
            toast.error(t("ai_saveError"));
        } finally {
            setSaving(false);
        }
    };

    if (failed) return <LoadFailed onRetry={() => void load()} />;
    if (!screen || !draft) return <Waiting label={t("ai_loading")} />;

    return (
        <form onSubmit={handleSave} className="space-y-6">
            <AdminPageHeader
                title={t("ai_title")}
                description={t("ai_description")}
                actions={
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {saving ? t("ai_saving") : t("ai_save")}
                    </Button>
                }
            />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <AiProviderCard
                    providers={screen.providers}
                    active={screen.active}
                    chosen={draft.active}
                    onChoose={(active) => setDraft({ ...draft, active })}
                />
                <AiLimitsCard
                    draft={draft}
                    bounds={screen.bounds}
                    modules={modules}
                    onChange={(next) => setDraft({ ...draft, ...next })}
                />
                <AiUsageCard usage={screen.usage} purposes={screen.purposes} windowDays={screen.windowDays} />
                <AiPurposesCard purposes={screen.purposes} />
            </div>
        </form>
    );
}
