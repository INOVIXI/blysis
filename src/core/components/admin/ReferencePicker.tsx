"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Input } from "@/core/components/ui/input";
import { cn } from "@/core/lib/utils";

/**
 * A field that names another record, filled by picking rather than typing.
 *
 * The bulk discount screen asked for a product id and a category id in two
 * text boxes, and the creator code screen asked for a user id in a third.
 * Nothing in the panel shows a category's id, so the only way to fill one in
 * was to open the database - and a mistyped id is refused by nothing. It
 * simply makes a discount that never applies to anything.
 *
 * What is stored is still the id. What is shown is the name, because the name
 * is the only part anybody knows.
 *
 * Two things beyond the obvious:
 *
 *   - editing an existing row shows the name of what is already chosen. A
 *     caller that already has it - a row that joined the creator's username -
 *     passes `valueLabel` and nothing is asked for;
 *   - an id that resolves to nothing says so. Blank would read as "nothing is
 *     set", and saving would then clear a reference that was only
 *     unresolvable rather than absent.
 */

/** How long typing has to stop before the endpoint is asked. */
const SETTLE_MS = 300;

export interface ReferencePickerProps {
    /** The id held by the form. */
    value: string;
    onChange: (id: string) => void;
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
    /** The name of the current value, when the caller already has it. */
    valueLabel?: string;
    placeholder?: string;
    className?: string;
}

interface Row {
    id: string;
    label: string;
    hint?: string;
}

export function ReferencePicker({
    value,
    onChange,
    label,
    endpoint,
    listKey,
    labelField,
    hintField,
    searchParam = "search",
    valueLabel,
    placeholder,
    className,
}: ReferencePickerProps) {
    const t = useTranslations("common");
    const [term, setTerm] = React.useState("");
    const [rows, setRows] = React.useState<Row[]>([]);
    const [open, setOpen] = React.useState(false);
    /** The name of whatever `value` points at, once anybody knows it. */
    const [chosen, setChosen] = React.useState<string | null>(valueLabel ?? null);
    /** The id whose name has been resolved, so it is asked for once. */
    const resolved = React.useRef<string | null>(null);

    const read = React.useCallback(
        async (search: string): Promise<Row[]> => {
            const url = new URL(endpoint, window.location.origin);
            if (search) url.searchParams.set(searchParam, search);
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
        [endpoint, listKey, labelField, hintField, searchParam],
    );

    // The caller's own name for the value wins, and changes with it.
    React.useEffect(() => {
        if (valueLabel) setChosen(valueLabel);
    }, [valueLabel]);

    /*
     * Look the current id up when nobody has told us its name. An edit form
     * opens holding an id and has to show a name.
     *
     * The guard is a ref set when the answer arrives, not a state set when the
     * question is asked. Under StrictMode the effect runs, is cleaned up and
     * runs again: a flag set on the way in made the second run return early
     * while the first run's answer had already been thrown away by its own
     * cleanup, so the box stayed empty and nothing was ever asked twice
     * because nothing was ever asked successfully once.
     */
    React.useEffect(() => {
        if (!value || chosen !== null || resolved.current === value) return;
        let cancelled = false;
        void read("").then((list) => {
            if (cancelled) return;
            resolved.current = value;
            setRows(list);
            setChosen(list.find((row) => row.id === value)?.label ?? "");
        });
        return () => { cancelled = true; };
    }, [value, chosen, read]);

    // Typing asks the endpoint, after a pause: a list backed by a query
    // otherwise answers once per keystroke and out of order.
    React.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void read(term).then((list) => { if (!cancelled) setRows(list); });
        }, term ? SETTLE_MS : 0);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [term, open, read]);

    const unresolved = value !== "" && chosen === "";
    const shown = open ? term : (chosen ?? "");

    return (
        <div className={cn("relative", className)}>
            <div className="relative">
                <Input
                    role="combobox"
                    aria-expanded={open}
                    aria-label={label}
                    placeholder={placeholder ?? t("search")}
                    value={shown}
                    onFocus={() => { setOpen(true); setTerm(""); }}
                    onBlur={() => {
                        // After the click on an option has had its turn.
                        setTimeout(() => setOpen(false), 150);
                    }}
                    onChange={(event) => { setOpen(true); setTerm(event.target.value); }}
                    className={value ? "pr-9" : undefined}
                />
                {value !== "" && (
                    <button
                        type="button"
                        onClick={() => { onChange(""); setChosen(null); resolved.current = null; setTerm(""); }}
                        aria-label={t("clear")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                )}
            </div>

            {unresolved && (
                <p className="mt-1 text-xs text-destructive">{t("referenceNotFound", { id: value })}</p>
            )}

            {open && rows.length > 0 && (
                <ul
                    role="listbox"
                    aria-label={label}
                    className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
                >
                    {rows.map((row) => (
                        <li key={row.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={row.id === value}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    onChange(row.id);
                                    setChosen(row.label);
                                    setOpen(false);
                                }}
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
    );
}
