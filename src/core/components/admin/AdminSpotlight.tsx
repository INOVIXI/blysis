"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { useRouter } from "@/core/lib/i18n/navigation";
import { ModalLayer } from "@/core/components/ui/modal-layer";
import { type AdminNavReader, useAdminNav, type AdminNavModule } from "@/core/hooks/useAdminNav";
import { ModuleRoutes, ModuleSettingsCards } from "@/core/generated/module-registry";
import { offerableRoutes } from "@/core/lib/admin-search";
import { adminHref } from "@/core/lib/admin-path";
import type { NavIconComponent } from "@/core/lib/admin-nav-groups";
import { Search, X, FileText, User, Settings as SettingsIcon, Package } from "lucide-react";

interface SearchResult {
    type: string;
    id: string;
    title: string;
    /** Said in the reader's language where the sender had a key for it. */
    titleKey?: string;
    subtitle?: string;
    href: string;
}

/** One row of the palette, whichever side it came from. */
interface Entry {
    key: string;
    href: string;
    title: string;
    subtitle?: string;
    /** The word drawn on the right: a group of things, never a `type`. */
    kindKey: string | null;
    Icon: NavIconComponent;
}

/**
 * What a kind of result is called. A kind with no entry here draws nothing
 * rather than its own name: `type` is how the code sorts results, and
 * "module-page" in the corner of a row is the code talking to itself.
 */
const KIND_KEY: Record<string, string> = {
    settings: "spotlight_settings",
    "module-page": "spotlight_modules",
    user: "spotlight_members",
};

const KIND_ICON: Record<string, NavIconComponent> = {
    settings: SettingsIcon,
    "module-page": Package,
    user: User,
};

/**
 * The panel's search: Cmd+K, or the box in the header.
 *
 * It used to be two things reading one endpoint - a box with a dropdown of its
 * own, and this palette - drawing the same answers two ways. And the answers
 * were English whatever the panel was in, because the endpoint carried a hand
 * copy of the sidebar: twelve titles, written in English, under a comment
 * saying they mirror the sidebar's. Measured on a Turkish panel, "kullan",
 * "ayar" and "yard" each found nothing, while the sidebar three inches away
 * said Kullanıcılar, Ayarlar and Yardım Merkezi.
 *
 * The navigation is already here, already translated, already knowing what
 * this installation has: the screens come from it. The endpoint answers for
 * the things navigation cannot know - a member by name, a module's settings
 * card, whatever a module adds through `admin.search.results`.
 */
export function AdminSpotlight({
    modules = [],
    activeThemeId,
    reader,
}: {
    modules?: AdminNavModule[];
    activeThemeId?: string;
    /** Offer only what this person may open: the palette is a way in. */
    reader?: AdminNavReader;
}) {
    const router = useRouter();
    const locale = useLocale();
    const t = useTranslations("common");
    // The palette's own copy lives in the admin namespace; `t` above is the
    // shared one, for the close button.
    const at = useTranslations("admin");

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [found, setFound] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const groups = useAdminNav(modules, activeThemeId, reader);

    const enabled = useMemo(() => new Set(modules.map((module) => module.id)), [modules]);

    /**
     * Every screen the panel has, under the name this reader would see.
     *
     * All of it is built here rather than asked for, because everything that
     * names a screen is already in the browser: the navigation, translated,
     * and the registry the navigation itself is built from. The endpoint has
     * a module's id and no locale of its own, so it used to score that id
     * against what was typed - which answers nothing to anyone searching in
     * a language the id is not written in.
     */
    const pages = useMemo(() => {
        const rows: Entry[] = [];
        const seen = new Set<string>();

        for (const group of groups) {
            for (const section of group.sections) {
                for (const item of section.items) {
                    seen.add(item.href);
                    rows.push({
                        key: `page:${item.href}`,
                        href: item.href,
                        title: item.labelKey && at.has(item.labelKey) ? at(item.labelKey) : item.label,
                        subtitle: group.labelKey && at.has(group.labelKey) ? at(group.labelKey) : group.label,
                        kindKey: "spotlight_pages",
                        Icon: item.icon ?? FileText,
                    });
                }
            }
        }

        // A module's settings screen. Most of these are now sidebar links as
        // well and were caught by the loop above; what is left is a card
        // whose module chose not to list it, and it is still searchable.
        // The name is the module's own translation, because a manifest
        // literal is one language.
        for (const card of ModuleSettingsCards) {
            if (!enabled.has(card.module)) continue;
            const href = adminHref(card.href);
            if (seen.has(href)) continue;
            seen.add(href);
            rows.push({
                key: `settings:${href}`,
                href,
                title: at.has(`settings_${card.module}`) ? at(`settings_${card.module}`) : card.title,
                subtitle: at.has(`settings_${card.module}_description`)
                    ? at(`settings_${card.module}_description`)
                    : card.description,
                kindKey: "spotlight_settings",
                Icon: SettingsIcon,
            });
        }

        // A screen a module ships and lists nowhere. A manifest may declare
        // an admin route and no menu entry for it, and then this is the only
        // door to that screen.
        const routes = ModuleRoutes.map((route) => ({ ...route, path: adminHref(route.path) }));
        for (const route of offerableRoutes(routes, seen)) {
            if (!enabled.has(route.module)) continue;
            seen.add(route.path);
            const key = `module_${route.module}_name`;
            rows.push({
                key: `module-page:${route.key}`,
                href: route.path,
                title: at.has(key) ? at(key) : route.module,
                subtitle: route.path,
                kindKey: "spotlight_modules",
                Icon: Package,
            });
        }

        return rows;
    }, [groups, at, enabled]);

    // Keyboard shortcut: Cmd+K / Ctrl+K
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setOpen((v) => !v);
            }
            // Escape belongs to useModalDialog, along with the trap and
            // returning focus to whatever had it before Cmd+K.
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    // autoFocus is off because the palette focuses its own input below on a
    // short delay; the hook still traps Tab, closes on Escape and hands focus
    // back to whatever had it when the palette opened.
    const dialogRef = useModalDialog<HTMLDivElement>(open, () => setOpen(false), { autoFocus: false });

    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            setQuery("");
            setFound([]);
            setSelected(0);
        }
    }, [open]);

    // Debounced, and only for what the browser cannot answer itself.
    useEffect(() => {
        if (query.trim().length < 2) {
            setFound([]);
            return;
        }
        setLoading(true);
        // The timer covers a keystroke landing before the request goes out;
        // `cancelled` covers one landing after it, whose answer would otherwise
        // arrive late and put the previous query's results under the new one.
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/v1/admin/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (cancelled) return;
                    setFound(data.results || []);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 200);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);

    /*
     * Matched in the reader's language, not in the browser's. Turkish maps I
     * and i differently from English, so a dotted capital in "İşlemler"
     * lower-cases to something a plain `toLowerCase` never matches.
     */
    const rows = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase(locale);
        if (needle.length < 2) return [];
        const local = pages.filter((page) => page.title.toLocaleLowerCase(locale).includes(needle));
        const remote: Entry[] = found.map((result) => ({
            key: `${result.type}:${result.id}`,
            href: result.href,
            title: result.titleKey && at.has(result.titleKey) ? at(result.titleKey) : result.title,
            subtitle: result.subtitle,
            kindKey: KIND_KEY[result.type] ?? null,
            Icon: KIND_ICON[result.type] ?? FileText,
        }));
        const seen = new Set<string>();
        return [...local, ...remote].filter((row) => {
            if (seen.has(row.href)) return false;
            seen.add(row.href);
            return true;
        }).slice(0, 20);
    }, [pages, found, query, locale, at]);

    useEffect(() => { setSelected(0); }, [rows.length]);

    const go = (href: string) => {
        router.push(href);
        setOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((i) => Math.min(i + 1, rows.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const row = rows[selected];
            if (row) go(row.href);
        }
    };

    return (
        <>
            {/* The header's box. It used to be a second search with a dropdown
                of its own reading the same endpoint; it opens the one palette
                now, and says how to open it without the mouse. */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
                <Search className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-left">{at("search_placeholder")}</span>
                <kbd className="hidden lg:inline rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">
                    {at("spotlight_shortcut")}
                </kbd>
            </button>

            {open && (
                <ModalLayer>
                    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-32 px-4" role="presentation">
                        <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
                        <div
                            ref={dialogRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label={at("spotlight_placeholder")}
                            className="relative bg-card rounded-lg shadow-2xl border border-border w-full max-w-xl overflow-hidden"
                        >
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                                <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                                <input
                                    ref={inputRef}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    placeholder={at("spotlight_placeholder")}
                                    aria-label={at("spotlight_placeholder")}
                                    /*
                                     * `text-sm` because everything else in
                                     * this dialog is sized and this was not:
                                     * a form control inherits the base 16px
                                     * while the results under it are 14px, so
                                     * the box a reader types into was visibly
                                     * bigger than the site it was searching.
                                     *
                                     * The focus ring stays. Taking it off
                                     * looked tidier - the dialog puts the
                                     * caret here on open, so the ring is
                                     * drawn every time rather than saying
                                     * anything - but `outline-none` with
                                     * nothing in its place is what
                                     * `form-control-names` refuses, and it is
                                     * right to: the caret is the one focus
                                     * indicator a reader can miss.
                                     */
                                    className="flex-1 bg-transparent text-sm rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                                />
                                <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted rounded">ESC</kbd>
                                <button onClick={() => setOpen(false)} aria-label={t("close")} className="text-muted-foreground hover:text-foreground">
                                    <X className="w-4 h-4" aria-hidden="true" />
                                </button>
                            </div>

                            <div className="max-h-96 overflow-y-auto">
                                {query.trim().length < 2 ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">{at("spotlight_startTyping")}</div>
                                ) : rows.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">
                                        {loading ? at("spotlight_searching") : at("spotlight_noResults")}
                                    </div>
                                ) : (
                                    <div className="py-1">
                                        {rows.map((row, i) => {
                                            const Icon = row.Icon;
                                            return (
                                                <button
                                                    key={row.key}
                                                    type="button"
                                                    onClick={() => go(row.href)}
                                                    onMouseEnter={() => setSelected(i)}
                                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                                        i === selected ? "bg-muted" : ""
                                                    }`}
                                                >
                                                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm text-foreground truncate">{row.title}</div>
                                                        {row.subtitle && (
                                                            <div className="text-xs text-muted-foreground truncate">{row.subtitle}</div>
                                                        )}
                                                    </div>
                                                    {row.kindKey && (
                                                        <span className="text-[10px] text-muted-foreground">{at(row.kindKey)}</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
                                <div className="flex items-center gap-2">
                                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>
                                    <span>{at("spotlight_navigate")}</span>
                                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↵</kbd>
                                    <span>{at("spotlight_open")}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">{at("spotlight_shortcut")}</kbd>
                                    <span>{at("spotlight_toggle")}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </ModalLayer>
            )}
        </>
    );
}
