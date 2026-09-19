"use client";

/**
 * The left pane: every page the site serves, in one scrolling column.
 *
 * The screen this replaced started empty and asked an operator to type a path
 * from memory, so a page nobody had thought to add was a page with no SEO and
 * no sign that it was missing. Here the list is the site, and a row says
 * whether anything has been set on it.
 */

import { useTranslations } from "next-intl";
import { Badge, ListControls } from "@/core/sdk/ui";
import type { CataloguePage, SeoOverride } from "../../../lib/catalogue";

interface Props {
    pages: CataloguePage[];
    overrides: SeoOverride[];
    selected: string;
    query: string;
    onQueryChange: (value: string) => void;
    onSelect: (path: string) => void;
}

export function SeoPageList({ pages, overrides, selected, query, onQueryChange, onSelect }: Props) {
    const t = useTranslations("seo");
    const customised = new Set(overrides.map((o) => o.path));

    const needle = query.trim().toLowerCase();
    const shown = needle
        ? pages.filter((p) => p.title.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle))
        : pages;

    // Grouped by whoever serves the page, core first. Forty-eight rows in one
    // alphabetical run is a list you scroll rather than read, and an operator
    // looking for the shop's pages wants them next to each other.
    const groups = new Map<string, CataloguePage[]>();
    for (const page of shown) {
        const rows = groups.get(page.owner) ?? [];
        rows.push(page);
        groups.set(page.owner, rows);
    }
    const ordered = [...groups.entries()].sort(([a], [b]) =>
        a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b),
    );

    return (
        <div className="flex flex-col h-full">
            {/* The shared strip, not a box of its own. This screen grew one
                before there was a shared one, and it was the only search in
                the panel with its own spacing and no way to clear it. */}
            <div className="p-3 border-b border-border">
                <ListControls search={{ value: query, onChange: onQueryChange, placeholder: t("adm_searchPages") }} />
            </div>

            {shown.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">{t("adm_noMatches")}</p>
            ) : (
                <div className="overflow-y-auto max-h-[34rem] w-full">
                    {ordered.map(([owner, rows]) => (
                        <section key={owner}>
                            <h3 className="sticky top-0 bg-muted/60 backdrop-blur px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {owner === "core" ? t("adm_ownerCore") : owner}
                            </h3>
                            <ul className="divide-y divide-border">
                                {rows.map((page) => {
                                    const active = page.path === selected;
                                    return (
                                        <li key={page.path}>
                                            <button
                                                type="button"
                                                onClick={() => onSelect(page.path)}
                                                aria-current={active ? "true" : undefined}
                                                className={`w-full text-left px-4 py-3 transition-colors ${
                                                    active ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
                                                }`}
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className="font-medium text-sm truncate">{page.title}</span>
                                                    {customised.has(page.path) && (
                                                        <Badge tone="info" className="shrink-0">{t("adm_overridden")}</Badge>
                                                    )}
                                                </span>
                                                <span className="block font-mono text-xs text-muted-foreground truncate">{page.path}</span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
