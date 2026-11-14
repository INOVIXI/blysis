"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent } from "@/core/sdk/ui";
import { SettingsForm } from "@/core/sdk/admin";
import { Link } from "@/core/sdk/navigation";
import { OPENROUTER_DEFAULTS, OPENROUTER_EFFORTS } from "../../lib/defaults";

type Problem = "not_configured" | "unauthorized" | "unreachable" | "rate_limited" | "failed";

/**
 * The key, the models and the effort OpenRouter is asked with.
 *
 * Trying the connection lists the models the saved key may use, and the model
 * fields then suggest them. Nothing is asked of OpenRouter until the operator
 * presses the button, so opening this screen never spends or sends anything.
 */
export default function OpenRouterSettingsPage() {
    const t = useTranslations("openrouterProvider");
    const [models, setModels] = useState<string[]>([]);
    const [trying, setTrying] = useState(false);
    const [outcome, setOutcome] = useState<{ ok: true; count: number } | { ok: false; problem: Problem } | null>(null);

    const tryIt = async () => {
        setTrying(true);
        setOutcome(null);
        try {
            const res = await fetch("/api/v1/openrouter-provider/admin/connection", { method: "POST" });
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
                { key: "openrouter_api_key", label: t("adm_keyLabel"), type: "password", placeholder: "sk-or-...", description: t("adm_keyDesc") },
                {
                    key: "openrouter_model_fast",
                    label: t("adm_fastLabel"),
                    placeholder: OPENROUTER_DEFAULTS.modelFast,
                    description: t("adm_fastDesc", { model: OPENROUTER_DEFAULTS.modelFast }),
                    suggestions: models,
                },
                {
                    key: "openrouter_model_smart",
                    label: t("adm_smartLabel"),
                    placeholder: OPENROUTER_DEFAULTS.modelSmart,
                    description: t("adm_smartDesc", { model: OPENROUTER_DEFAULTS.modelSmart }),
                    suggestions: models,
                },
                {
                    key: "openrouter_effort",
                    label: t("adm_effortLabel"),
                    type: "select",
                    defaultValue: OPENROUTER_DEFAULTS.effort,
                    options: OPENROUTER_EFFORTS.map((value) => ({ value, label: t(`adm_effort_${value}`) })),
                    description: t("adm_effortDesc"),
                },
                { key: "openrouter_app_title", label: t("adm_titleLabel"), description: t("adm_titleDesc") },
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
