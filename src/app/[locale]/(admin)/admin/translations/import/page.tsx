"use client";

import { useRef, useState } from "react";
import { ArrowRight, FileUp, Loader2, Replace } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { Checkbox } from "@/core/components/ui/checkbox";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { localeNames, type Locale } from "@/core/lib/i18n/config";
import { errorMessage } from "@/core/lib/write-result";

/**
 * A file of a site's words, brought in.
 *
 * The file is one the translations screen exported, from this site or
 * another. Nothing is written until the operator has seen every string it
 * would change, as the site says it now and as the file says it, and kept
 * the ones they mean. A string the check would refuse is shown and cannot be
 * kept; each change is an ordinary edit afterwards, with its own history.
 */

interface Change {
    namespace: string;
    key: string;
    locale: Locale;
    before: string | null;
    after: string;
    refused?: { reason: string; names: string[] };
}

interface Preview {
    changes: Change[];
    unknown: number;
    same: number;
}

const REFUSED: Record<string, string> = {
    new_placeholder: "translations_errNewPlaceholder",
    malformed: "translations_errMalformed",
    empty: "translations_errEmpty",
    too_long: "translations_errTooLong",
};

const nameOf = (c: Pick<Change, "namespace" | "key" | "locale">) => `${c.namespace}.${c.key}:${c.locale}`;

export default function ImportWordsPage() {
    const t = useTranslations("admin");
    const { confirm } = useConfirm();
    const picker = useRef<HTMLInputElement>(null);

    // The file as read, so what is applied is what was previewed.
    const [file, setFile] = useState<unknown>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [kept, setKept] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

    const call = async (body: { file: unknown; apply?: Pick<Change, "namespace" | "key" | "locale">[] }) => {
        const res = await fetch("/api/v1/admin/translations/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return res.json();
    };

    const look = async (words: unknown) => {
        setBusy("preview");
        try {
            const body = await call({ file: words });
            if (!body?.ok) {
                toast.error(body?.code === "translation_file_invalid"
                    ? t("translations_importNotFile")
                    : errorMessage(body, t("translations_errGeneric"), t));
                return;
            }
            const found = body.data as Preview;
            setFile(words);
            setPreview(found);
            setKept(new Set(found.changes.filter((c) => !c.refused).map(nameOf)));
        } catch {
            toast.error(t("translations_errGeneric"));
        } finally {
            setBusy(null);
        }
    };

    const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = event.target.files?.[0];
        event.target.value = "";
        if (!chosen) return;
        let words: unknown;
        try {
            words = JSON.parse(await chosen.text());
        } catch {
            toast.error(t("translations_importNotFile"));
            return;
        }
        await look(words);
    };

    const apply = async () => {
        if (!preview) return;
        const chosen = preview.changes.filter((c) => !c.refused && kept.has(nameOf(c)));
        const sure = await confirm({
            title: t("translations_importTitle"),
            message: t("translations_replaceConfirm", { count: chosen.length }),
        });
        if (!sure) return;
        setBusy("apply");
        try {
            const body = await call({ file, apply: chosen.map(({ namespace, key, locale }) => ({ namespace, key, locale })) });
            if (!body?.ok) {
                toast.error(errorMessage(body, t("translations_errGeneric"), t));
                return;
            }
            toast.success(t("translations_replaced", { count: body.data.changed }));
        } catch {
            toast.error(t("translations_errGeneric"));
        } finally {
            setBusy(null);
        }
        // What is left is what was not kept or could not be.
        await look(file);
    };

    const toggle = (name: string, on: boolean) => {
        setKept((current) => {
            const next = new Set(current);
            if (on) next.add(name);
            else next.delete(name);
            return next;
        });
    };

    const chosen = preview ? preview.changes.filter((c) => !c.refused && kept.has(nameOf(c))).length : 0;

    return (
        <>
            <AdminPageHeader
                title={t("translations_importTitle")}
                description={t("translations_importDescription")}
                backHref="/admin/translations"
                backLabel={t("translations_title")}
            />

            <Card className="mb-6">
                <CardContent className="p-4 flex flex-wrap items-center gap-3">
                    <input
                        type="file"
                        accept="application/json,.json"
                        ref={picker}
                        aria-label={t("translations_importPick")}
                        className="hidden"
                        onChange={pick}
                    />
                    <Button variant="outline" disabled={busy !== null} onClick={() => picker.current?.click()}>
                        {busy === "preview" ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                            <FileUp className="w-4 h-4" aria-hidden="true" />
                        )}
                        {t("translations_importPick")}
                    </Button>
                    {preview ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            {[
                                preview.unknown > 0 ? t("translations_importUnknown", { count: preview.unknown }) : null,
                                preview.same > 0 ? t("translations_importSame", { count: preview.same }) : null,
                            ].filter(Boolean).join(" ")}
                        </p>
                    ) : null}
                </CardContent>
            </Card>

            {preview === null ? null : preview.changes.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {t("translations_importNone")}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="space-y-2">
                        {preview.changes.map((c) => {
                            const name = nameOf(c);
                            const reason = c.refused ? REFUSED[c.refused.reason] : undefined;
                            return (
                                <Card key={name}>
                                    <CardContent className="p-3 flex items-start gap-3">
                                        <Checkbox
                                            aria-label={name}
                                            checked={!c.refused && kept.has(name)}
                                            disabled={Boolean(c.refused) || busy !== null}
                                            onChange={(event) => toggle(name, event.target.checked)}
                                        />
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <p className="text-xs text-muted-foreground break-all">
                                                <span className="font-mono">{c.namespace}.{c.key}</span> · {localeNames[c.locale]}
                                            </p>
                                            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center">
                                                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                                                    {c.before ?? t("translations_missing")}
                                                </p>
                                                <ArrowRight className="hidden w-4 h-4 text-muted-foreground md:block" aria-hidden="true" />
                                                <p className="whitespace-pre-wrap break-words">{c.after}</p>
                                            </div>
                                            {c.refused ? (
                                                <p className="text-xs text-destructive">
                                                    {reason
                                                        ? t(reason, { locale: c.locale, names: c.refused.names.join(", ") })
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
