"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Input } from "@/core/components/ui/input";
import { cn } from "@/core/lib/utils";

/**
 * A field that names several other records, filled by picking rather than
 * typing.
 *
 * `ReferencePicker` answers this for one record and nothing answered it for a
 * list, which is why the only scope anything could be given was a single
 * product or a single category. For a row an operator can write as many of as
 * they like that is a limitation; for one whose code is unique it is a wall,
 * because the second product cannot be named at all.
 *
 * What is stored is still the ids. What is shown is the names, because the
 * name is the only part anybody knows - including for what was chosen last
 * month, which is why an endpoint may be asked to name a set of ids outright
 * rather than only searched.
 */

/** How long typing has to stop before the endpoint is asked. */
const SETTLE_MS = 300;

export interface ReferenceListProps {
    /** The ids held by the form, in the order they were added. */
    value: readonly string[];
    onChange: (ids: string[]) => void;
    /** Names the box for a screen reader, and labels what is being chosen. */
    label: string;
    /** Where the records are listed. */
    endpoint: string;
    /** The array's name in the response. */
    listKey: string;
    /** Which column is the name a person knows. */
    labelField: string;
    /** A second line under the name - a slug, an address. */
    hintField?: string;
    /** The query parameter this endpoint narrows by. */
    searchParam?: string;
    /**
     * The parameter that asks for particular ids, comma separated.
     *
     * An endpoint that ignores it still works: what is already chosen is then
     * named only if it is on the first page the endpoint answers with, and
     * anything else keeps its place in the value while saying it could not be
     * named. Silently dropping it would edit the row on opening it.
     */
    idsParam?: string;
    placeholder?: string;
    className?: string;
}

interface Row {
    id: string;
    label: string;
    hint?: string;
}

export function ReferenceList({
    value,
    onChange,
    label,
    endpoint,
    listKey,
    labelField,
    hintField,
    searchParam = "search",
    idsParam = "ids",
    placeholder,
    className,
}: ReferenceListProps) {
    const t = useTranslations("common");
    const [term, setTerm] = React.useState("");
    const [rows, setRows] = React.useState<Row[]>([]);
    const [open, setOpen] = React.useState(false);
    /** Every name learned so far, whichever read taught it. */
    const [names, setNames] = React.useState<Record<string, string>>({});

    const read = React.useCallback(
        async (params: Record<string, string>): Promise<Row[]> => {
            const url = new URL(endpoint, window.location.origin);
            for (const [key, val] of Object.entries(params)) {
                if (val) url.searchParams.set(key, val);
            }
            const res = await fetch(url.pathname + url.search);
            if (!res.ok) return [];
            const data = (await res.json()) as Record<string, unknown>;
            const list = Array.isArray(data[listKey]) ? (data[listKey] as Record<string, unknown>[]) : [];
            return list.map((row) => ({
                id: String(row.id ?? ""),
                label: String(row[labelField] ?? ""),
                hint: hintField ? String(row[hintField] ?? "") : undefined,
            }));
        },
        [endpoint, listKey, labelField, hintField],
    );

    const learn = React.useCallback((learned: Row[]) => {
        setNames((known) => {
            const next = { ...known };
            for (const row of learned) next[row.id] = row.label;
            return next;
        });
    }, []);

    /*
     * Name whatever is already held. The guard is the set of ids still
     * unnamed, so a second pass is asked for only when the value grows to
     * include something nobody has named yet.
     */
    const unnamed = value.filter((id) => names[id] === undefined).join(",");
    React.useEffect(() => {
        if (!unnamed) return;
        let cancelled = false;
        void read({ [idsParam]: unnamed }).then((list) => {
            if (!cancelled) learn(list);
        });
        return () => { cancelled = true; };
    }, [unnamed, idsParam, read, learn]);

    // Typing asks the endpoint, after a pause: a list backed by a query
    // otherwise answers once per keystroke and out of order.
    React.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void read({ [searchParam]: term }).then((list) => {
                if (cancelled) return;
                setRows(list);
                learn(list);
            });
        }, term ? SETTLE_MS : 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [term, open, searchParam, read, learn]);

    const chosen = new Set(value);
    const offered = rows.filter((row) => !chosen.has(row.id));

    const add = (id: string) => {
        if (chosen.has(id)) return;
        onChange([...value, id]);
        setTerm("");
    };

    const drop = (id: string) => onChange(value.filter((held) => held !== id));

    return (
        <div className={cn("space-y-2", className)}>
            {value.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                    {value.map((id) => (
                        <li key={id}>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
                                {names[id] ?? t("referenceNotFound", { id })}
                                <button
                                    type="button"
                                    onClick={() => drop(id)}
                                    aria-label={t("remove")}
                                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                                >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            <div className="relative">
                <Input
                    role="combobox"
                    aria-expanded={open}
                    aria-label={label}
                    placeholder={placeholder ?? t("search")}
                    value={term}
                    onFocus={() => setOpen(true)}
                    onBlur={() => {
                        // After the click on an option has had its turn.
                        setTimeout(() => setOpen(false), 150);
                    }}
                    onChange={(event) => { setOpen(true); setTerm(event.target.value); }}
                />

                {open && offered.length > 0 && (
                    <ul
                        role="listbox"
                        aria-label={label}
                        className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
                    >
                        {offered.map((row) => (
                            <li key={row.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={false}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => add(row.id)}
                                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                    {row.label}
                                    {row.hint ? (
                                        <span className="block text-xs text-muted-foreground">{row.hint}</span>
                                    ) : null}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
