"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Check, History, Loader2, RotateCcw, Save } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/core/components/ui/badge";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { Textarea } from "@/core/components/ui/textarea";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { moduleName } from "@/core/lib/module-label";
import { TranslationHistory } from "./TranslationHistory";

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
 * What the site would say without the operator's edit is printed under a box
 * that no longer matches it, so an operator can see what they are departing
 * from without leaving the screen, and so "restore" has a visible meaning.
 * Beside the name is who says the string now: core, a module, the theme
 * being worn, which may word a module's string in its own voice.
 *
 * A string that wants looking at says so above its boxes: an update that
 * moved the original under the site's edit, with both originals side by
 * side, or a change in another language since this one was written. Each
 * notice carries its two answers, and the history holds the way back from
 * any change.
 */

export interface EntryLocale {
    value: string | null;
    /** The source whose row the site reads. */
    from: string | null;
    isCustom: boolean;
    /** What the site would say without its own edit. */
    shipped: string | null;
    /** An update moved the original under the site's edit. */
    review: { was: string; now: string } | null;
    /** The string changed in another language after this one was written. */
    awaiting: boolean;
}

export interface Entry {
    namespace: string;
    key: string;
    /** Every source with a row for the string, lowest voice first. */
    sources: string[];
    locales: Record<string, EntryLocale>;
}

/** A translation source as the filters endpoint names it; core has no name. */
export interface Source {
    id: string;
    name: string | null;
}

const THEME_SOURCE = "theme:";

/**
 * What the panel calls a source: core in the reader's language, a module by
 * the name it ships for itself, a theme as a theme.
 */
export function useSourceLabel(sources: Source[]): (id: string) => string {
    const t = useTranslations("admin");
    const locale = useLocale();
    return (id) => {
        if (id === "core") return t("translations_sourceCore");
        const name = sources.find((s) => s.id === id)?.name ?? id;
        if (id.startsWith(THEME_SOURCE)) return t("translations_sourceTheme", { name });
        return moduleName({ id, name }, locale, t);
    };
}

interface TranslationEntryProps {
    entry: Entry;
    labelOf: (source: string) => string;
    /** What everything is translated from; shown, never edited here. */
    source: Locale;
    /** What the operator is working in. */
    target: Locale;
    onSave: (values: Record<string, string>) => Promise<boolean>;
    onRestore: () => Promise<boolean>;
    /** Take the new original in the working language. */
    onAdopt: () => Promise<boolean>;
    /** The working language has been looked at and stands. */
    onMark: (reason: "review" | "translate") => Promise<boolean>;
    onUndo: (version: string) => Promise<boolean>;
}

type Action = "save" | "restore" | "adopt" | "review" | "translate";

function draftOf(entry: Entry, target: Locale): Record<string, string> {
    return { [target]: entry.locales[target]?.value ?? "" };
}

export function TranslationEntry({ entry, labelOf, source, target, onSave, onRestore, onAdopt, onMark, onUndo }: TranslationEntryProps) {
    const t = useTranslations("admin");
    const [draft, setDraft] = useState(() => draftOf(entry, target));
    const [busy, setBusy] = useState<Action | null>(null);
    const [showHistory, setShowHistory] = useState(false);

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
    const boxId = `${entry.namespace}-${entry.key}-${target}`;
    // An edited string is the site's own words, which the badge says.
    const saidBy = state?.isCustom ? null : (state?.from ?? entry.sources.at(-1) ?? null);

    const send = async (which: Action) => {
        setBusy(which);
        const done = which === "save" ? await onSave(draft)
            : which === "restore" ? await onRestore()
                : which === "adopt" ? await onAdopt()
                    : await onMark(which);
        setBusy(null);
        return done;
    };
    const spinner = (which: Action, icon: ReactNode) =>
        busy === which ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : icon;

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
                    <div className="min-w-0 flex items-center gap-2 flex-wrap">
                        <p className="font-mono text-xs break-all">
                            {entry.namespace}.{entry.key}
                        </p>
                        {saidBy ? (
                            <span className="text-xs text-muted-foreground">
                                {t("translations_saidBy", { source: labelOf(saidBy) })}
                            </span>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {state?.review ? <Badge tone="warning">{t("translations_toReview")}</Badge> : null}
                        {state?.awaiting ? <Badge tone="warning">{t("translations_awaiting")}</Badge> : null}
                        {edited ? <Badge tone="info">{t("translations_edited")}</Badge> : null}
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={showHistory}
                            onClick={() => setShowHistory(!showHistory)}
                        >
                            <History className="w-4 h-4" aria-hidden="true" />
                            {t("translations_history")}
                        </Button>
                        {edited ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => send("restore")}
                            >
                                {spinner("restore", <RotateCcw className="w-4 h-4" aria-hidden="true" />)}
                                {t("translations_restore")}
                            </Button>
                        ) : null}
                        <Button size="sm" disabled={!dirty || busy !== null} onClick={() => send("save")}>
                            {spinner("save", <Save className="w-4 h-4" aria-hidden="true" />)}
                            {t("translations_save")}
                        </Button>
                    </div>
                </div>

                {state?.review ? (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm space-y-2">
                        <p>{t("translations_reviewNote")}</p>
                        <p className="break-words text-muted-foreground">{t("translations_reviewWas", { value: state.review.was })}</p>
                        <p className="break-words">{t("translations_reviewNow", { value: state.review.now })}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => send("review")}>
                                {spinner("review", <Check className="w-4 h-4" aria-hidden="true" />)}
                                {t("translations_keepMine")}
                            </Button>
                            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => send("adopt")}>
                                {spinner("adopt", <RotateCcw className="w-4 h-4" aria-hidden="true" />)}
                                {t("translations_useNew")}
                            </Button>
                        </div>
                    </div>
                ) : null}
                {state?.awaiting ? (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm flex items-center justify-between gap-3 flex-wrap">
                        <p>{t("translations_awaitingNote")}</p>
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => send("translate")}>
                            {spinner("translate", <Check className="w-4 h-4" aria-hidden="true" />)}
                            {t("translations_stillRight")}
                        </Button>
                    </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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

                {showHistory ? (
                    <TranslationHistory
                        namespace={entry.namespace}
                        stringKey={entry.key}
                        source={source}
                        target={target}
                        version={entry}
                        onUndo={onUndo}
                    />
                ) : null}
            </CardContent>
        </Card>
    );
}
