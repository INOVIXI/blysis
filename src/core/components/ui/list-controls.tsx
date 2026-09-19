"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/core/lib/i18n/navigation";
import { Input } from "@/core/components/ui/input";
import { NativeSelect } from "@/core/components/ui/native-select";
import { cn } from "@/core/lib/utils";

/**
 * The strip above a list: one box to search it, and the selects that narrow it.
 *
 * Every list a member owns - their activity, their conversations, their
 * devices, their orders - answered with whatever happened to be newest and no
 * way to reach the rest. The admin screens had grown their own search boxes
 * one at a time, each with its own spacing, its own placeholder and its own
 * idea of whether a magnifier belongs inside the field; a member's screens had
 * none at all. This is that strip written once, so the box is in the same
 * place on every list a reader meets.
 *
 * It holds the typed text itself and hands it up after a pause. A list backed
 * by an endpoint would otherwise ask the server once per keystroke, and the
 * answers come back out of order - the reader types six letters and the list
 * settles on the result for four of them.
 *
 * The pause is only a pause: `value` stays the caller's, and a change from
 * outside (a cleared filter, a restored address) replaces what is in the box.
 */

/** How long typing has to stop before the caller hears about it. */
const SETTLE_MS = 300;

export interface ListFilter {
    /** Unique within the strip; also the select's accessible name is `label`. */
    id: string;
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}

/**
 * Two kinds of list, two places the term can live.
 *
 * A list whose rows are all in the browser is searched there, and the caller
 * holds the term. A list the server pages - users, the audit log, the
 * activity log - cannot be: searching the fifty rows that happened to arrive
 * tells an operator there is no such member because they are on page nine
 * hundred. Those search in the query, so the term rides in the address and
 * the result is something to bookmark, reload and send to a colleague.
 *
 * `param` is what `Pagination` already does with the page number: one
 * component with two modes rather than two components that drift apart.
 */
export interface ListSearch {
    /** Held by the caller. Required unless `param` is given. */
    value?: string;
    onChange?: (value: string) => void;
    /** Held in the address, under this query parameter. */
    param?: string;
    /** Defaults to the shared "Search" label. */
    placeholder?: string;
}

export interface ListControlsProps {
    search?: ListSearch;
    filters?: ListFilter[];
    className?: string;
}

export function ListControls({ search, filters, className }: ListControlsProps) {
    if (search?.param) return <UrlSearchControls search={search} filters={filters} className={className} />;
    return <HeldControls search={search} filters={filters} className={className} />;
}

/**
 * The address holds the term.
 *
 * The page is dropped rather than kept: a search run from page nine that
 * matches two rows has no page nine to show, and the reader gets an empty
 * table under a full count. Every other parameter rides along, which is what
 * keeps a search and a filter usable together.
 */
function UrlSearchControls({ search, filters, className }: ListControlsProps & { search: ListSearch }) {
    const pathname = usePathname();
    const params = useSearchParams();
    const router = useRouter();
    const param = search.param as string;

    // The string, not the object. `useSearchParams` hands back a fresh
    // instance on every render, so a callback that depended on it changed
    // identity every render - and the debounce below clears its timer
    // whenever the callback changes, so the search never fired at all.
    const query = params?.toString() ?? "";

    const apply = React.useCallback(
        (term: string) => {
            const next = new URLSearchParams(query);
            // `?q=` and no parameter are the same screen; only one of them
            // should be linkable.
            if (term === "") next.delete(param);
            else next.set(param, term);
            next.delete("page");
            const href = next.toString();
            router.push(href ? `${pathname}?${href}` : pathname);
        },
        [query, pathname, router, param],
    );

    return (
        <HeldControls
            className={className}
            filters={filters}
            search={{ value: params?.get(param) ?? "", onChange: apply, placeholder: search.placeholder }}
        />
    );
}

function HeldControls({ search, filters, className }: ListControlsProps) {
    const t = useTranslations("common");
    const [draft, setDraft] = React.useState(search?.value ?? "");
    const settled = search?.value ?? "";

    // Whatever the caller says the term is wins: a filter reset elsewhere on
    // the screen has to empty the box, and this is the only thing that does.
    React.useEffect(() => {
        setDraft(settled);
    }, [settled]);

    const onChange = search?.onChange;
    React.useEffect(() => {
        if (!onChange || draft === settled) return;
        const timer = setTimeout(() => onChange(draft), SETTLE_MS);
        return () => clearTimeout(timer);
    }, [draft, settled, onChange]);

    if (!search && !filters?.length) return null;

    return (
        <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", className)}>
            {search && (
                <div className="relative flex-1 min-w-0">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        type="search"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={search.placeholder ?? t("search")}
                        aria-label={search.placeholder ?? t("search")}
                        className="pl-9 pr-9"
                    />
                    {draft !== "" && (
                        <button
                            type="button"
                            // Clearing is one key away on a desktop keyboard and
                            // nowhere at all on a phone, where this list is read.
                            onClick={() => setDraft("")}
                            aria-label={t("clear")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                </div>
            )}

            {/* The width lives on a wrapper rather than on the control.
                `NativeSelect` moves a layout class of its own onto the box it
                draws the chevron against, and it recognises `w-48` but not
                `sm:w-48` - so a responsive width stayed on the element, the
                box stayed full width, and the select ate the row the search
                box was supposed to grow into: the field measured 74 pixels
                with the dropdown sitting on top of it. */}
            {filters?.map((filter) => (
                <div key={filter.id} className="w-full shrink-0 sm:w-48">
                    <NativeSelect
                        value={filter.value}
                        aria-label={filter.label}
                        onChange={(event) => filter.onChange(event.target.value)}
                        className="w-full"
                    >
                        {filter.options.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </NativeSelect>
                </div>
            ))}
        </div>
    );
}
