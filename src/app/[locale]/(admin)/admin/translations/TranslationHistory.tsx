"use client";

import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/core/components/ui/button";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";
import { localeNames, type Locale } from "@/core/lib/i18n/config";

/**
 * What a string said before each change to it, and the way back to it.
 *
 * Read when the operator opens it rather than with the list, since most
 * strings are never looked back at. Each version shows the language being
 * worked in and the one it is translated from, whichever of the two it
 * touched.
 */

interface Version {
    id: string;
    createdAt: string;
    author: string | null;
    cause: "edit" | "restore" | "replace" | "undo";
    locales: Record<string, { value: string | null; isCustom: boolean }>;
}

const CAUSES = {
    edit: "translations_historyEdit",
    restore: "translations_historyRestore",
    replace: "translations_historyReplace",
    undo: "translations_historyUndo",
} as const;

interface TranslationHistoryProps {
    namespace: string;
    stringKey: string;
    source: Locale;
    target: Locale;
    /** Bumped when the string changes, so an open history reads again. */
    version: unknown;
    onUndo: (id: string) => Promise<boolean>;
}

export function TranslationHistory({ namespace, stringKey, source, target, version, onUndo }: TranslationHistoryProps) {
    const t = useTranslations("admin");
    const when = useLocalDateTime();
    const [versions, setVersions] = useState<Version[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        const load = async () => {
            try {
                const params = new URLSearchParams({ namespace, key: stringKey });
                const res = await fetch(`/api/v1/admin/translations/history?${params}`);
                const body = await res.json();
                if (!live) return;
                if (body?.ok) setVersions(body.data.items as Version[]);
                else setFailed(true);
            } catch {
                if (live) setFailed(true);
            }
        };
        load();
        return () => {
            live = false;
        };
    }, [namespace, stringKey, version]);

    if (failed) return <p className="text-xs text-destructive">{t("translations_historyFailed")}</p>;
    if (versions === null) {
        return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label={t("translations_history")} />;
    }
    if (versions.length === 0) return <p className="text-xs text-muted-foreground">{t("translations_historyEmpty")}</p>;

    return (
        <ol className="space-y-2" aria-label={t("translations_history")}>
            {versions.map((v) => (
                <li key={v.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-muted-foreground">
                            {t("translations_historyLine", {
                                cause: t(CAUSES[v.cause]),
                                who: v.author ?? t("translations_historySomeone"),
                                when: when(v.createdAt),
                            })}
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={async () => {
                                setBusy(v.id);
                                await onUndo(v.id);
                                setBusy(null);
                            }}
                        >
                            {busy === v.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                                <Undo2 className="w-4 h-4" aria-hidden="true" />
                            )}
                            {t("translations_undo")}
                        </Button>
                    </div>
                    {[target, source].filter((l) => l in v.locales).map((l) => (
                        <p key={l} className="mt-1 break-words">
                            <span className="text-xs text-muted-foreground">{localeNames[l]}: </span>
                            {v.locales[l].value ?? t("translations_missing")}
                        </p>
                    ))}
                </li>
            ))}
        </ol>
    );
}
