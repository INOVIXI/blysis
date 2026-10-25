"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Replace, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { Checkbox } from "@/core/components/ui/checkbox";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { NativeSelect } from "@/core/components/ui/native-select";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { errorMessage } from "@/core/lib/write-result";

/**
 * One word replaced in every string the site says it in.
 *
 * An operator who calls the shop "Market" would otherwise edit the menu, the
 * heading, the cart and a dozen buttons one line at a time, and miss one.
 * Nothing is written until the operator has seen every string the word is in,
 * before and after, and kept the ones they mean. A replacement that would
 * break a string is shown and cannot be kept; each change is an ordinary edit
 * afterwards, put back from the translations list like any other.
 */

interface Match {
    namespace: string;
    key: string;
    before: string;
    after: string;
    refused?: { reason: string; names: string[] };
}

interface Asked {
    find: string;
    replace: string;
    locale: Locale;
}

const REFUSED: Record<string, string> = {
    new_placeholder: "translations_errNewPlaceholder",
    malformed: "translations_errMalformed",
    empty: "translations_errEmpty",
    too_long: "translations_errTooLong",
};

const nameOf = (m: { namespace: string; key: string }) => `${m.namespace}.${m.key}`;

export default function ReplaceWordPage() {
    const t = useTranslations("admin");
    const locale = useLocale();
    const { confirm } = useConfirm();

    const [find, setFind] = useState("");
    const [replace, setReplace] = useState("");
    const [language, setLanguage] = useState<Locale>(() =>
        (locales as readonly string[]).includes(locale) ? (locale as Locale) : locales[0]);
    // What the preview below answers, so changing a box after looking cannot
    // write something the operator never saw.
    const [asked, setAsked] = useState<Asked | null>(null);
    const [matches, setMatches] = useState<Match[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [kept, setKept] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

    const call = async (body: Asked & { apply?: { namespace: string; key: string }[] }) => {
        const res = await fetch("/api/v1/admin/translations/replace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.json();
    };

    const preview = async (question: Asked) => {
        setBusy("preview");
        try {
            const body = await call(question);
            if (!body?.ok) {
                toast.error(errorMessage(body, t("translations_errGeneric"), t));
                return;
            }
            const found = body.data.matches as Match[];
            setAsked(question);
            setMatches(found);
            setTruncated(Boolean(body.data.truncated));
            setKept(new Set(found.filter((m) => !m.refused).map(nameOf)));
        } catch {
            toast.error(t("translations_errGeneric"));
        } finally {
            setBusy(null);
        }
    };

    const apply = async () => {
        if (!asked) return;
        const chosen = matches.filter((m) => !m.refused && kept.has(nameOf(m)));
        const sure = await confirm({
            title: t("translations_replaceTitle"),
            message: t("translations_replaceConfirm", { count: chosen.length }),
        });
        if (!sure) return;
        setBusy("apply");
        try {
            const body = await call({ ...asked, apply: chosen.map(({ namespace, key }) => ({ namespace, key })) });
            if (!body?.ok) {
                toast.error(body?.code === "translation_nothing_to_replace"
                    ? t("translations_errNothingToReplace")
                    : errorMessage(body, t("translations_errGeneric"), t));
                return;
            }
            toast.success(t("translations_replaced", { count: body.data.changed }));
        } catch {
            toast.error(t("translations_errGeneric"));
        } finally {
            setBusy(null);
        }
        // What is left is what was not kept or could not be.
        await preview(asked);
    };

    const toggle = (name: string, on: boolean) => {
        setKept((current) => {
            const next = new Set(current);
            if (on) next.add(name);
            else next.delete(name);
            return next;
        });
    };

    const chosen = matches.filter((m) => !m.refused && kept.has(nameOf(m))).length;

    return (
        <>
            <AdminPageHeader
                title={t("translations_replaceTitle")}
                description={t("translations_replaceDescription")}
                backHref="/admin/translations"
                backLabel={t("translations_title")}
            />

            <Card className="mb-6">
                <CardContent className="p-4">
                    <form
                        className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (find) preview({ find, replace, locale: language });
                        }}
                    >
                        <div className="space-y-1">
                            <Label htmlFor="replace-find">{t("translations_replaceFind")}</Label>
                            <Input id="replace-find" value={find} maxLength={200} onChange={(e) => setFind(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="replace-with">{t("translations_replaceWith")}</Label>
                            <Input id="replace-with" value={replace} maxLength={200} onChange={(e) => setReplace(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="replace-language">{t("translations_workingIn")}</Label>
                            <NativeSelect
                                id="replace-language"
                                value={language}
                                onChange={(event) => setLanguage(event.target.value as Locale)}
                            >
                                {locales.map((l) => (
                                    <option key={l} value={l}>{localeNames[l]}</option>
                                ))}
                            </NativeSelect>
                        </div>
                        <Button type="submit" disabled={!find || busy !== null}>
                            {busy === "preview" ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                                <Search className="w-4 h-4" aria-hidden="true" />
                            )}
                            {t("translations_replacePreview")}
                        </Button>
                    </form>
                    <p className="mt-3 text-xs text-muted-foreground">{t("translations_replaceCase")}</p>
                </CardContent>
            </Card>

            {asked === null ? null : matches.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {t("translations_replaceNone")}
                    </CardContent>
                </Card>
            ) : (
                <>
                    {truncated ? (
                        <p role="status" className="mb-3 text-sm text-muted-foreground">
                            {t("translations_replaceTruncated", { count: matches.length })}
                        </p>
                    ) : null}
                    <div className="space-y-2">
                        {matches.map((m) => {
                            const name = nameOf(m);
                            const reason = m.refused ? REFUSED[m.refused.reason] : undefined;
                            return (
                                <Card key={name}>
                                    <CardContent className="p-3 flex items-start gap-3">
                                        <Checkbox
                                            aria-label={name}
                                            checked={!m.refused && kept.has(name)}
                                            disabled={Boolean(m.refused) || busy !== null}
                                            onChange={(event) => toggle(name, event.target.checked)}
                                        />
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <p className="font-mono text-xs break-all text-muted-foreground">{name}</p>
                                            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
                                                <p className="whitespace-pre-wrap break-words text-muted-foreground">{m.before}</p>
                                                <ArrowRight className="hidden w-4 h-4 text-muted-foreground md:block" aria-hidden="true" />
                                                <p className="whitespace-pre-wrap break-words">{m.after}</p>
                                            </div>
                                            {m.refused ? (
                                                <p className="text-xs text-destructive">
                                                    {reason
                                                        ? t(reason, { locale: asked.locale, names: m.refused.names.join(", ") })
                                                        : t("translations_replaceRefused")}
                                                </p>
                                            ) : null}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                    <div className="mt-4 flex justify-end">
                        <Button disabled={chosen === 0 || busy !== null} onClick={apply}>
                            {busy === "apply" ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                                <Replace className="w-4 h-4" aria-hidden="true" />
                            )}
                            {t("translations_replaceApply", { count: chosen })}
                        </Button>
                    </div>
                </>
            )}
        </>
    );
}
