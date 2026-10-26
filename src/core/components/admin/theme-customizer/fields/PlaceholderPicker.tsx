"use client";

import { useEffect, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Braces } from "lucide-react";
import { Button } from "@/core/components/ui/button";
import { sharedJson } from "@/core/lib/shared-request";
import { placeholderTokens, type PlaceholderValue } from "@/core/lib/placeholder-text";

interface Listed {
    name: string;
    module: string;
    labelKey: string;
    example: string | null;
    value: PlaceholderValue;
}

/**
 * The site placeholders an operator can write into this text, to pick from
 * rather than remember, and the ones it already holds that nothing answers.
 *
 * One request for every field on the screen: the list is the site's, not the
 * field's. A label is a key in the panel's translations, a module's under its
 * own `admin` keys, translated here as the sidebar translates a menu entry.
 *
 * A token nothing answers is shown as a dash in a theme's text, and refused
 * outright in a translation, whose `refuses` says so instead.
 */
export function PlaceholderPicker({ text, onPick, refuses = false }: { text: string; onPick: (token: string) => void; refuses?: boolean }) {
    const t = useTranslations("admin");
    const format = useFormatter();
    const listId = useId();
    const [open, setOpen] = useState(false);
    const [listed, setListed] = useState<Listed[] | null>(null);

    useEffect(() => {
        let active = true;
        sharedJson<{ placeholders?: Listed[] }>("/api/v1/admin/placeholders")
            .then((d) => { if (active) setListed(Array.isArray(d?.placeholders) ? d.placeholders : []); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    const known = new Set((listed ?? []).map((p) => p.name));
    const unknown = listed === null ? [] : [...new Set(placeholderTokens(text).map((token) => token.name))].filter((name) => !known.has(name));
    const shown = (value: PlaceholderValue) =>
        value === null ? t("placeholder_noValue") : typeof value === "number" ? format.number(value) : value;

    return (
        <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((was) => !was)}>
                <Braces className="w-4 h-4" aria-hidden="true" />
                {t("placeholder_insert")}
            </Button>
            {open && (
                <ul id={listId} aria-label={t("placeholder_list")} className="rounded-lg border border-border bg-card divide-y divide-border">
                    {(listed ?? []).map((p) => (
                        <li key={p.name}>
                            <button
                                type="button"
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                                onClick={() => { onPick(`{${p.name}}`); setOpen(false); }}
                            >
                                <span className="min-w-0">
                                    <span className="block text-foreground">{t.has(p.labelKey) ? t(p.labelKey) : p.name}</span>
                                    {/* Not `code`: dark mode paints every one of those as a
                                        block of muted colour, which light mode does not. */}
                                    <span className="block font-mono text-xs text-muted-foreground">{`{${p.name}}`}</span>
                                </span>
                                <span className="shrink-0 text-muted-foreground">{shown(p.value)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {unknown.length > 0 && (
                <p className="text-xs text-warning">{t(refuses ? "placeholder_refused" : "placeholder_unknown", { names: unknown.map((name) => `{${name}}`).join(", ") })}</p>
            )}
        </div>
    );
}
