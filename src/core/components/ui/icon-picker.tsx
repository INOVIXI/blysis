"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { iconNames } from "lucide-react/dynamic";
import { useTranslations } from "next-intl";
import { Search, X, ChevronDown } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { NavIcon } from "./NavIcon";
import { ModalLayer } from "./modal-layer";
import { iconLabel, searchIconNames, toIconSlug } from "@/core/lib/icon-names";
import { cn } from "@/core/lib/utils";

/**
 * Picks a Lucide icon from a searchable dialog.
 *
 * Replaces the free-text icon inputs that used to sit behind every icon field:
 * an admin had to know a name from lucide.dev, and a typo silently rendered no
 * icon at all. Everything here works from the same name list lucide's dynamic
 * loader uses, so the list can never drift from what `NavIcon` can render.
 *
 * Tiles are rendered a page at a time. Each one mounts a `DynamicIcon`, which
 * fetches that icon's chunk on its own, so painting all ~2000 at once would
 * fire ~2000 requests for icons nobody scrolled to.
 */

const PAGE_SIZE = 120;

export interface IconPickerProps {
    value?: string | null;
    onChange: (value: string) => void;
    /** Shown on the trigger while no icon is chosen. */
    placeholder?: string;
    id?: string;
    className?: string;
    disabled?: boolean;
    /**
     * Icon names to offer. Defaults to every icon lucide ships; injectable so a
     * test does not have to mount two thousand lazily-loaded tiles.
     */
    names?: readonly string[];
}

export function IconPicker({
    value,
    onChange,
    placeholder,
    id,
    className,
    disabled,
    names = iconNames,
}: IconPickerProps) {
    const t = useTranslations("admin");
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [visible, setVisible] = useState(PAGE_SIZE);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const selected = value ? toIconSlug(value) : "";
    const matches = useMemo(() => searchIconNames(names, query), [names, query]);
    const shown = matches.slice(0, visible);

    // A new search starts back at the first page, otherwise a narrow result set
    // inherits the "load more" state of the previous, wider one.
    useEffect(() => { setVisible(PAGE_SIZE); }, [query]);

    // autoFocus is off because the search box wants focus rather than whatever
    // happens to be first in the dialog. Escape, the Tab trap and handing focus
    // back are the hook's.
    const dialogRef = useModalDialog<HTMLDivElement>(open, () => close(), { autoFocus: false });

    useEffect(() => {
        if (!open) return;
        searchRef.current?.focus();
    }, [open]);

    const close = () => {
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
    };

    const choose = (name: string) => {
        onChange(name);
        close();
    };

    return (
        <>
            <div className={cn("flex items-center gap-1", className)}>
                <button
                    id={id}
                    ref={triggerRef}
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    className="flex h-10 flex-1 min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {selected
                        ? <NavIcon name={selected} className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        : <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className={cn("truncate", !selected && "text-muted-foreground")}>
                        {selected || placeholder || t("iconPicker_choose")}
                    </span>
                    <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
                {selected && !disabled && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("iconPicker_clear")}
                        title={t("iconPicker_clear")}
                        onClick={() => onChange("")}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {open && (
                <ModalLayer>
                    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
                        <div className="fixed inset-0 bg-black/50" onClick={close} aria-hidden="true" />
                        <div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label={t("iconPicker_title")}
                            className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--blysis-color-border)] bg-card shadow-2xl"
                        >
                            <div className="flex items-center gap-2 border-b border-border p-4">
                                <Input
                                    ref={searchRef}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={t("iconPicker_search")}
                                    aria-label={t("iconPicker_search")}
                                />
                                <Button type="button" variant="ghost" size="icon" aria-label={t("iconPicker_close")} onClick={close}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4">
                                {shown.length === 0 ? (
                                    <p className="py-8 text-center text-sm text-muted-foreground">
                                        {t("iconPicker_empty")}
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
                                        {shown.map((name) => (
                                            <button
                                                key={name}
                                                type="button"
                                                onClick={() => choose(name)}
                                                aria-pressed={name === selected}
                                                title={iconLabel(name)}
                                                className={cn(
                                                    "flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors hover:border-primary hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50",
                                                    name === selected ? "border-primary bg-muted" : "border-transparent",
                                                )}
                                            >
                                                <NavIcon name={name} className="h-5 w-5 text-foreground" />
                                                <span className="w-full truncate text-[10px] leading-tight text-muted-foreground">
                                                    {name}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-2 border-t border-border p-4">
                                <p className="text-xs text-muted-foreground">
                                    {t("iconPicker_count", { shown: shown.length, total: matches.length })}
                                </p>
                                {shown.length < matches.length && (
                                    <Button type="button" variant="outline" size="sm" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
                                        {t("iconPicker_loadMore")}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </ModalLayer>
            )}
        </>
    );
}
