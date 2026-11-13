"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import type { AiDraft, AiScreen } from "./ai-screen-data";

type LimitKey = "timeoutSeconds" | "dailyTokenLimit" | "requestsPerMinute" | "retentionDays";

const LIMITS: { key: LimitKey; label: string; help: string }[] = [
    { key: "dailyTokenLimit", label: "ai_dailyTokenLimit", help: "ai_dailyTokenLimitHelp" },
    { key: "requestsPerMinute", label: "ai_requestsPerMinute", help: "ai_requestsPerMinuteHelp" },
    { key: "timeoutSeconds", label: "ai_timeoutSeconds", help: "ai_timeoutSecondsHelp" },
    { key: "retentionDays", label: "ai_retentionDays", help: "ai_retentionDaysHelp" },
];

interface AiLimitsCardProps {
    draft: AiDraft;
    bounds: AiScreen["bounds"];
    /** Every module that says it sends something, so each can be given a cap. */
    modules: string[];
    onChange: (next: Partial<AiDraft>) => void;
}

function asNumber(raw: string): number {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

export function AiLimitsCard({ draft, bounds, modules, onChange }: AiLimitsCardProps) {
    const t = useTranslations("admin");

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t("ai_limitsTitle")}</CardTitle>
                <CardDescription>{t("ai_limitsHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {LIMITS.map(({ key, label, help }) => (
                        <div key={key} className="space-y-1.5">
                            <Label htmlFor={`ai-${key}`}>{t(label)}</Label>
                            <Input
                                id={`ai-${key}`}
                                type="number"
                                min={bounds[key].min}
                                max={bounds[key].max}
                                step={1}
                                value={draft[key]}
                                onChange={(e) => onChange({ [key]: asNumber(e.target.value) })}
                                aria-describedby={`ai-${key}-help`}
                            />
                            <p id={`ai-${key}-help`} className="text-xs text-muted-foreground">{t(help)}</p>
                        </div>
                    ))}
                </div>

                {modules.length > 0 && (
                    <div className="space-y-3">
                        <div>
                            <h3 className="text-sm font-medium">{t("ai_moduleLimitsTitle")}</h3>
                            <p className="text-xs text-muted-foreground">{t("ai_moduleLimitsHelp")}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {modules.map((module) => (
                                <div key={module} className="space-y-1.5">
                                    <Label htmlFor={`ai-limit-${module}`} className="font-mono text-xs">{module}</Label>
                                    <Input
                                        id={`ai-limit-${module}`}
                                        type="number"
                                        min={0}
                                        max={bounds.dailyTokenLimit.max}
                                        step={1}
                                        value={draft.moduleTokenLimits[module] ?? 0}
                                        onChange={(e) => onChange({
                                            moduleTokenLimits: { ...draft.moduleTokenLimits, [module]: asNumber(e.target.value) },
                                        })}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
