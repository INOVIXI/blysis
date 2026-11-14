"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent } from "@/core/sdk/ui";
import { SettingsForm } from "@/core/sdk/admin";
import { Link } from "@/core/sdk/navigation";
import { OPENAI_DEFAULTS, OPENAI_EFFORTS } from "../../lib/defaults";

type Problem = "not_configured" | "unauthorized" | "unreachable" | "rate_limited" | "failed";

/**
 * The key, the models and the effort OpenAI is asked with.
 *
 * Trying the connection lists the models the saved key may use, and the model
 * fields then suggest them. Nothing is asked of OpenAI until the operator
 * presses the button, so opening this screen never spends or sends anything.
 */
export default function OpenAISettingsPage() {
    const t = useTranslations("openaiProvider");
    const [models, setModels] = useState<string[]>([]);
    const [trying, setTrying] = useState(false);
    const [outcome, setOutcome] = useState<{ ok: true; count: number } | { ok: false; problem: Problem } | null>(null);

    const tryIt = async () => {
        setTrying(true);
        setOutcome(null);
        try {
            const res = await fetch("/api/v1/openai-provider/admin/connection", { method: "POST" });
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
                { key: "openai_api_key", label: t("adm_keyLabel"), type: "password", placeholder: "sk-...", description: t("adm_keyDesc") },
                {
                    key: "openai_model_fast",
                    label: t("adm_fastLabel"),
                    placeholder: OPENAI_DEFAULTS.modelFast,
                    description: t("adm_fastDesc", { model: OPENAI_DEFAULTS.modelFast }),
                    suggestions: models,
                },
                {
                    key: "openai_model_smart",
                    label: t("adm_smartLabel"),
                    placeholder: OPENAI_DEFAULTS.modelSmart,
                    description: t("adm_smartDesc", { model: OPENAI_DEFAULTS.modelSmart }),
                    suggestions: models,
                },
                {
                    key: "openai_effort",
                    label: t("adm_effortLabel"),
                    type: "select",
                    defaultValue: OPENAI_DEFAULTS.effort,
                    options: OPENAI_EFFORTS.map((value) => ({ value, label: t(`adm_effort_${value}`) })),
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
