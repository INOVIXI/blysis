"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { Checkbox } from "@/core/components/ui/checkbox";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { Radio } from "@/core/components/ui/radio";
import { Waiting } from "@/core/components/ui/waiting";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { errorMessage } from "@/core/lib/write-result";

/**
 * Which languages the site offers its visitors, and which one it opens in.
 *
 * The setup wizard asked the second question and nothing used the answer;
 * the first was never asked, so every site offered all twelve languages the
 * software ships, translated or not. Each row says how much of the site is
 * written in that language, so an operator offers one knowing what a visitor
 * reading it will find. The panel is not affected: it stays in whatever
 * language its reader chose.
 */

interface Coverage {
    locale: string;
    held: number;
    missing: number;
}

const REFUSALS: Record<string, string> = {
    languages_default_not_offered: "languages_errDefaultNotOffered",
    languages_invalid: "languages_errInvalid",
};

export default function LanguagesPage() {
    const t = useTranslations("admin");
    const [offered, setOffered] = useState<Locale[]>([]);
    const [preferred, setPreferred] = useState<Locale | null>(null);
    const [coverage, setCoverage] = useState<Coverage[]>([]);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const [site, facets] = await Promise.all([
                fetch("/api/v1/admin/languages").then((res) => res.json()),
                fetch("/api/v1/admin/translations/filters").then((res) => res.json()),
            ]);
            if (!site?.ok) throw new Error("languages");
            setOffered(site.data.offered);
            setPreferred(site.data.preferred);
            // How much of the site each language holds is help, not the
            // answer: a screen that could not count still saves.
            setCoverage(facets?.ok ? facets.data.locales : []);
        } catch {
            setFailed(true);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const toggle = (locale: Locale, on: boolean) =>
        setOffered(on ? locales.filter((l) => l === locale || offered.includes(l)) : offered.filter((l) => l !== locale));

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/languages", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ offered, preferred }),
            });
            const body = await res.json();
            if (!body?.ok) {
                const key = body?.code ? REFUSALS[body.code] : undefined;
                toast.error(key ? t(key) : errorMessage(body, t("languages_saveFailed"), t));
                return;
            }
            setOffered(body.data.offered);
            setPreferred(body.data.preferred);
            toast.success(t("languages_saved"));
        } catch {
            toast.error(t("languages_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("languages_title")}
                description={t("languages_description")}
                actions={
                    <Button onClick={save} disabled={saving || preferred === null || offered.length === 0}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                        {t("languages_save")}
                    </Button>
                }
            />

            {failed ? (
                <LoadFailed onRetry={load} />
            ) : preferred === null ? (
                <Waiting label={t("languages_title")} />
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <ul className="divide-y divide-border">
                            {locales.map((locale) => {
                                const counted = coverage.find((row) => row.locale === locale);
                                const total = counted ? counted.held + counted.missing : 0;
                                const share = total > 0 && counted ? Math.round((counted.held / total) * 100) : null;
                                const isOffered = offered.includes(locale);
                                return (
                                    <li key={locale} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                                        <label className="flex min-w-[12rem] flex-1 items-center gap-3 text-sm">
                                            <Checkbox
                                                checked={isOffered}
                                                disabled={locale === preferred}
                                                aria-label={t("languages_offer", { language: localeNames[locale] })}
                                                onChange={(event) => toggle(locale, event.target.checked)}
                                            />
                                            <span className="font-medium">{localeNames[locale]}</span>
                                            <span className="font-mono text-xs text-muted-foreground">{locale}</span>
                                        </label>
                                        <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                                <div className="h-full rounded-full bg-primary" style={{ width: `${share ?? 0}%` }} />
                                            </div>
                                            <span className="min-w-[8rem] shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
                                                {counted ? t("languages_coverage", { held: counted.held, total }) : null}
                                            </span>
                                        </div>
                                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Radio
                                                name="preferred"
                                                checked={locale === preferred}
                                                disabled={!isOffered}
                                                aria-label={t("languages_opensInLabel", { language: localeNames[locale] })}
                                                onChange={() => setPreferred(locale)}
                                            />
                                            {t("languages_opensIn")}
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </CardContent>
                </Card>
            )}
        </>
    );
}
