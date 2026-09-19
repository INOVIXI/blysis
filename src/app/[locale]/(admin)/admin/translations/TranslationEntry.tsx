"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/core/components/ui/badge";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { Textarea } from "@/core/components/ui/textarea";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";

/**
 * One string: what it says in the source language, and what it says in the
 * one being worked in.
 *
 * This used to draw a box for every locale the site serves, in a grid two
 * columns wide. The reason was a good one and it still holds: an operator who
 * corrects the English and never sees that the Turkish still says the old
 * thing leaves the site half translated, and having both in front of them
 * makes leaving one alone a decision rather than an oversight.
 *
 * But that argument is about a pair - what you translate from and what you
 * translate into - and the markup took it to mean *all of them*. With the two
 * this site ships, fifty keys made a page twelve thousand seven hundred
 * pixels tall; at twenty languages it is ten rows of boxes per key and the
 * endpoint sends every language's text for every key whether or not anybody
 * is working on it. So: the source, and one target the operator chooses.
 *
 * The source is read-only here. It is what the software ships and what
 * everything else is translated from; editing it belongs with the English
 * catalogue, not on a screen for translating away from it.
 *
 * What the software ships is printed under a box that no longer matches it,
 * so an operator can see what they are departing from without leaving the
 * screen, and so "restore" has a visible meaning.
 */

export interface EntryLocale {
    value: string | null;
    isCustom: boolean;
    shipped: string | null;
}

export interface Entry {
    module: string;
    namespace: string;
    key: string;
    locales: Record<string, EntryLocale>;
}

interface TranslationEntryProps {
    entry: Entry;
    /** What everything is translated from; shown, never edited here. */
    source: Locale;
    /** What the operator is working in. */
    target: Locale;
    onSave: (values: Record<string, string>) => Promise<boolean>;
    onRestore: () => Promise<boolean>;
}

function draftOf(entry: Entry, target: Locale): Record<string, string> {
    return { [target]: entry.locales[target]?.value ?? "" };
}

export function TranslationEntry({ entry, source, target, onSave, onRestore }: TranslationEntryProps) {
    const t = useTranslations("admin");
    const [draft, setDraft] = useState(() => draftOf(entry, target));
    const [busy, setBusy] = useState<"save" | "restore" | null>(null);

    // A page of keys is replaced wholesale when the filter or the page moves,
    // so the boxes follow the row they belong to rather than keeping what was
    // typed into the row that used to be in this position.
    useEffect(() => setDraft(draftOf(entry, target)), [entry, target]);

    const saved = draftOf(entry, target);
    const dirty = draft[target] !== saved[target];
    // Edited in any language, because Restore puts every one of them back.
    const edited = locales.some((locale) => entry.locales[locale]?.isCustom);
    const sourceText = entry.locales[source]?.value ?? entry.locales[source]?.shipped ?? "";
    const state = entry.locales[target];
    const shipped = state?.shipped ?? null;
    const boxId = `${entry.module}-${entry.namespace}-${entry.key}-${target}`;

    const send = async (which: "save" | "restore") => {
        setBusy(which);
        const done = which === "save" ? await onSave(draft) : await onRestore();
        setBusy(null);
        return done;
    };

    return (
        <Card>
            <CardContent className="p-3 space-y-2">
                {/*
                  * The key, and what can be done to it, on one line. Save and
                  * Restore used to sit on a line of their own under every
                  * card - fifty keys to a page, so fifty rows of mostly empty
                  * space, on a page already twelve thousand pixels tall.
                  */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <p className="font-mono text-xs break-all">
                            <span className="text-muted-foreground">{entry.module}</span>
                            {" "}
                            {entry.namespace}.{entry.key}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {edited ? <Badge tone="info">{t("translations_edited")}</Badge> : null}
            {edited ? (
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => send("restore")}
                >
                    {busy === "restore" ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                        <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    )}
                    {t("translations_restore")}
                </Button>
            ) : null}
            <Button size="sm" disabled={!dirty || busy !== null} onClick={() => send("save")}>
                {busy === "save" ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                    <Save className="w-4 h-4" aria-hidden="true" />
                )}
                {t("translations_save")}
            </Button>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                            {localeNames[source]}
                        </p>
                        {/* Read-only: this is what the software ships and
                            what the box beside it is a translation of. */}
                        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                            {sourceText || t("translations_missing")}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <label htmlFor={boxId} className="text-xs font-medium text-muted-foreground">
                            {localeNames[target]}
                        </label>
                        <Textarea
                            id={boxId}
                            rows={2}
                            value={draft[target] ?? ""}
                            placeholder={shipped ?? t("translations_missing")}
                            onChange={(event) => setDraft({ [target]: event.target.value })}
                        />
                        {shipped !== null && shipped !== (state?.value ?? "") ? (
                            <p className="text-xs text-muted-foreground break-words">
                                {t("translations_shipsAs", { value: shipped })}
                            </p>
                        ) : null}
                    </div>
                </div>

            </CardContent>
        </Card>
    );
}
