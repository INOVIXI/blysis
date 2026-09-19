"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { Pagination } from "@/core/components/ui/pagination";
import { ModalLayer } from "@/core/components/ui/modal-layer";

interface MediaItem {
    id: string;
    filename: string;
    url: string;
}

/**
 * The files this site already has, offered back to a field.
 *
 * Every upload lands in the media library and the panel has a screen that
 * lists it, but the screen only listed: there was no way back out of it into
 * a field. So an operator who wanted last month's banner on a second page
 * uploaded it a second time, and the library became a record of duplicates.
 *
 * Images only. A field that takes a picture has no use for the PDFs and ZIPs
 * the library also holds, and a shelf of things that cannot be chosen is
 * worse than a shorter shelf.
 */
export function MediaPicker({
    onPick,
    onClose,
}: {
    onPick: (url: string) => void;
    onClose: () => void;
}) {
    const t = useTranslations("common");
    const dialogRef = useModalDialog<HTMLDivElement>(true, onClose);

    const [items, setItems] = useState<MediaItem[]>([]);
    const [pages, setPages] = useState(1);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ type: "image", page: String(page), perPage: "24" });
            if (query) params.set("search", query);
            const res = await fetch(`/api/v1/media?${params}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { items?: MediaItem[]; pagination?: { totalPages?: number } };
            setItems(data.items ?? []);
            setPages(data.pagination?.totalPages ?? 1);
            // A read that worked lowers the flag, or the panel outlives the
            // outage and a retry that worked changes nothing.
            setFailed(false);
        } catch {
            // Not an empty shelf. "There is nothing here" and "we could not
            // find out" are different answers.
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => { void load(); }, [load, reloadKey]);

    const runSearch = useCallback(() => {
        setPage(1);
        setQuery(search.trim());
    }, [search]);

    return (
        <ModalLayer>
            <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
                <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="media-picker-title"
                    className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card p-5 shadow-2xl"
                >
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 id="media-picker-title" className="font-semibold text-foreground">
                            {t("mediaLibrary")}
                        </h2>
                        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label={t("close")}>
                            <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    </div>

                    {/* Not a form. A dialog is opened from inside one as often as
                        not, and a form inside a form is invalid HTML - React
                        reported it on every screen with an image field. Enter
                        still searches; it is handled rather than submitted. */}
                    <div className="mb-4 flex gap-2">
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                runSearch();
                            }}
                            placeholder={t("search")}
                            aria-label={t("search")}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={runSearch}>
                            {t("search")}
                        </Button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {failed ? (
                            <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                        ) : loading ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">{t("loading")}</p>
                        ) : items.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>
                        ) : (
                            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                                {items.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            onClick={() => { onPick(item.url); onClose(); }}
                                            title={item.filename}
                                            className="group w-full rounded-lg border border-border p-1 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                                        >
                                            {/* A plain `img`: the address came from
                                                whichever storage provider is active,
                                                and the optimiser would need every
                                                possible host configured in advance. */}
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={item.url}
                                                alt={item.filename}
                                                className="aspect-square w-full rounded object-contain bg-muted"
                                            />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {pages > 1 && (
                        <Pagination className="mt-4" page={page} pages={pages} onPageChange={setPage} />
                    )}
                </div>
            </div>
        </ModalLayer>
    );
}
