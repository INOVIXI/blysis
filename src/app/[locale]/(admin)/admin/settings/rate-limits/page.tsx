"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Slider } from "@/core/components/ui/slider";
import { Badge } from "@/core/components/ui/badge";
import { Loader2, Check, Infinity as InfinityIcon } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";

interface RoleRow {
    id: string;
    name: string;
    displayName: string;
    priority: number;
}

interface ApiResponse {
    roles: RoleRow[];
    multipliers: Record<string, number>;
}

export default function RateLimitsSettingsPage() {
    const t = useTranslations("admin");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [roles, setRoles] = useState<RoleRow[]>([]);
    const [values, setValues] = useState<Record<string, number>>({});

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/admin/rate-limits")
            .then((r) => r.json())
            .then((data: ApiResponse) => {
                if (cancelled) return;
                setRoles(data.roles || []);
                const clean: Record<string, number> = {};
                for (const [k, v] of Object.entries(data.multipliers || {})) {
                    clean[k] = typeof v === "number" ? v : Number(v) || 1;
                }
                setValues(clean);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                toast.error(t("rateLimits_loadError"));
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [t]);

    const setValue = (roleName: string, raw: number) => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 1));
        setValues((prev) => ({ ...prev, [roleName]: clamped }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/rate-limits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ multipliers: values }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                toast.error(errorMessage(j, t("rateLimits_saveError"), t));
                return;
            }
            toast.success(t("rateLimits_saved"));
        } catch {
            toast.error(t("rateLimits_saveError"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <form onSubmit={handleSave}>
            <AdminPageHeader
                title={t("rateLimits_title")}
                description={t("rateLimits_description")}
                actions={
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        {saving ? t("rateLimits_saving") : t("rateLimits_save")}
                    </Button>
                }
            />

            {roles.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                        {t("rateLimits_noRoles")}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <p className="mb-4 text-sm text-muted-foreground">{t("rateLimits_multiplierHelp")}</p>

                    {/* One card per role, filling the width. The screen used to
                        be a single `max-w-3xl` column with one row per role in
                        it, which left the right half of a desktop panel empty
                        while the rows themselves were cramped. */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {roles.map((role) => {
                            const current = values[role.name] ?? 1;
                            const isUnlimited = current === 0;
                            const sliderId = `rate-limit-${role.id}`;
                            return (
                                <Card key={role.id}>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">
                                            {role.displayName || role.name}
                                        </CardTitle>
                                        <CardDescription className="flex flex-wrap items-center gap-1.5">
                                            <Badge>
                                                <span className="font-mono">{role.name}</span>
                                            </Badge>
                                            <Badge>
                                                {t("rateLimits_priority")} {role.priority}
                                            </Badge>
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <Input
                                                id={`${sliderId}-value`}
                                                type="number"
                                                min={0}
                                                max={100}
                                                step={1}
                                                value={current}
                                                onChange={(e) => setValue(role.name, Number(e.target.value))}
                                                className="w-20 text-center"
                                                aria-label={`${role.displayName || role.name} ${t("rateLimits_multiplier")}`}
                                            />
                                            {isUnlimited ? (
                                                <Badge tone="success">
                                                    <InfinityIcon className="w-3 h-3" />
                                                    {t("rateLimits_unlimited")}
                                                </Badge>
                                            ) : (
                                                <span className="text-sm text-muted-foreground">
                                                    {t("rateLimits_timesBase", { count: current })}
                                                    {current === 1 && ` (${t("rateLimits_default")})`}
                                                </span>
                                            )}
                                        </div>
                                        <Slider
                                            id={sliderId}
                                            min={0}
                                            max={100}
                                            step={1}
                                            value={current}
                                            onChange={(e) => setValue(role.name, Number(e.target.value))}
                                            aria-label={`${role.displayName || role.name} ${t("rateLimits_multiplier")}`}
                                        />
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </>
            )}
        </form>
    );
}
