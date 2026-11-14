"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent } from "@/core/sdk/ui";
import { SettingsForm } from "@/core/sdk/admin";
import { Link } from "@/core/sdk/navigation";
import { ANTHROPIC_DEFAULTS, ANTHROPIC_EFFORTS } from "../../lib/defaults";

type Problem = "not_configured" | "unauthorized" | "unreachable" | "rate_limited" | "failed";

/**
 * The key, the models and the effort Claude is asked with.
 *
 * Trying the connection lists the models the saved key may use, and the model
 * fields then suggest them. Nothing is asked of Anthropic until the operator
 * presses the button, so opening this screen never spends or sends anything.
 */
export default function AnthropicSettingsPage() {
    const t = useTranslations("anthropicProvider");
    const [models, setModels] = useState<string[]>([]);
    const [trying, setTrying] = useState(false);
    const [outcome, setOutcome] = useState<{ ok: true; count: number } | { ok: false; problem: Problem } | null>(null);

    const tryIt = async () => {
        setTrying(true);
        setOutcome(null);
        try {
            const res = await fetch("/api/v1/anthropic-provider/admin/connection", { method: "POST" });
            const body = (await res.json().catch(() => ({}))) as { models?: string[]; code?: Problem };
            if (res.ok && Array.isArray(body.models)) {
                setModels(body.models);
                setOutcome({ ok: true, count: body.models.length });
            } else {
                setOutcome({ ok: false, problem: body.code ?? "failed" });
            }
        } catch {
            setOutcome({ ok: false, problem: "unreachable" });
        } finally {
            setTrying(false);
        }
    };

    return (
        <SettingsForm
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            fields={[
                { key: "anthropic_api_key", label: t("adm_keyLabel"), type: "password", placeholder: "sk-ant-...", description: t("adm_keyDesc") },
                {
                    key: "anthropic_model_fast",
                    label: t("adm_fastLabel"),
                    placeholder: ANTHROPIC_DEFAULTS.modelFast,
                    description: t("adm_fastDesc", { model: ANTHROPIC_DEFAULTS.modelFast }),
                    suggestions: models,
                },
                {
                    key: "anthropic_model_smart",
                    label: t("adm_smartLabel"),
                    placeholder: ANTHROPIC_DEFAULTS.modelSmart,
                    description: t("adm_smartDesc", { model: ANTHROPIC_DEFAULTS.modelSmart }),
                    suggestions: models,
                },
                {
                    key: "anthropic_effort",
                    label: t("adm_effortLabel"),
                    type: "select",
                    defaultValue: ANTHROPIC_DEFAULTS.effort,
                    options: ANTHROPIC_EFFORTS.map((value) => ({ value, label: t(`adm_effort_${value}`) })),
                    description: t("adm_effortDesc"),
                },
            ]}
        >
            <Card className="mt-6">
                <CardContent className="p-6 space-y-3">
                    <p className="text-sm text-muted-foreground">{t("adm_connDesc")}</p>
                    <div className="flex flex-wrap items-center gap-3">
                        <Button type="button" variant="outline" onClick={tryIt} disabled={trying}>
                            {trying && <Loader2 className="w-4 h-4 animate-spin" />}
                            {t("adm_connTry")}
                        </Button>
                        {outcome && (
                            <p role="status" className={outcome.ok ? "text-sm text-success" : "text-sm text-destructive"}>
                                {outcome.ok ? t("adm_connOk", { count: outcome.count }) : t(`adm_conn_${outcome.problem}`)}
                            </p>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        <Link href="/admin/settings/ai" className="text-primary hover:underline">{t("adm_chooseLink")}</Link>
                    </p>
                </CardContent>
            </Card>
        </SettingsForm>
    );
}
