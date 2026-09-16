"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { PageFrame } from "@/core/components/layout/PageFrame";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Input } from "@/core/components/ui/input";
import { Button } from "@/core/components/ui/button";
import { useTranslations } from "next-intl";
import { Loader2, File } from "lucide-react";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { SEARCH_QUERY_MAX_LENGTH } from "@/core/lib/constants";

interface SearchResult {
    type?: string;
    title: string;
    excerpt?: string;
    href: string;
    image?: string;
}

interface ResultGroup {
    id: string;
    label: string;
    icon?: string;
    results: SearchResult[];
}


export default function SearchPage() {
    const t = useTranslations("search");
    const params = useSearchParams();
    const initial = params.get("q") || "";
    const [query, setQuery] = useState(initial);
    const [groups, setGroups] = useState<ResultGroup[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const runSearch = async (q: string) => {
        if (q.trim().length < 2) return;
        setLoading(true);
        setSearched(true);
        try {
            const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            setGroups(data.groups || []);
            setTotal(data.total || 0);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        inputRef.current?.focus();
        if (initial.length >= 2) {
            runSearch(initial);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        runSearch(query);
        if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("q", query);
            window.history.replaceState(null, "", url.toString());
        }
    };

    return (
        /*
         * The frame, like every other public page. This drew its own shell at
         * `max-w-6xl` - a third width, beside the profile's `max-w-4xl` and
         * the activity feed's `max-w-3xl` - and no crumb trail. The icon went
         * with it: no other page title wears one.
         */
        <PageFrame title={t("title")}>
                <form onSubmit={onSubmit} className="flex gap-2 mb-6 max-w-2xl">
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("placeholder")}
                        className="flex-1"
                        maxLength={SEARCH_QUERY_MAX_LENGTH}
                        aria-label={t("searchQuery")}
                    />
                    <Button type="submit" disabled={query.trim().length < 2}>{t("searchButton")}</Button>
                </form>

                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label={t("loading")} />
                    </div>
                ) : !searched ? (
                    <Card>
                        <CardContent className="py-12 text-center text-muted-foreground">
                            {t("initialHint")}
                        </CardContent>
                    </Card>
                ) : groups.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center text-muted-foreground">
                            {t("noResults", { query })}
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        <p className="text-sm text-muted-foreground mb-4">
                            {t("resultsSummary", {
                                total,
                                totalLabel: total !== 1 ? t("results") : t("result"),
                                groups: groups.length,
                                groupsLabel: groups.length !== 1 ? t("sources") : t("source"),
                            })}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                            {groups.map((group) => {
                                return (
                                    <Card key={group.id} className="flex flex-col">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center justify-between gap-2">
                                                <span className="flex items-center gap-2">
                                                    {/* The name comes from whichever module answered the
                                                        search, so it is data rather than an import. */}
                                                    <NavIcon name={group.icon} className="w-4 h-4 text-primary" fallback={File} />
                                                    {group.label}
                                                </span>
                                                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                                    {group.results.length}
                                                </span>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-1 flex-1">
                                            {group.results.map((r, i) => (
                                                <a
                                                    key={`${group.id}-${i}`}
                                                    href={r.href}
                                                    className="block p-3 -mx-3 rounded-md hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                                                >
                                                    <div className="flex items-start gap-3">
                                                        {r.image && (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={r.image}
                                                                alt=""
                                                                className="w-12 h-12 rounded object-cover flex-shrink-0"
                                                            />
                                                        )}
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-medium text-foreground truncate">{r.title}</div>
                                                            {r.excerpt && (
                                                                <div className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                                                                    {r.excerpt}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </a>
                                            ))}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </>
                )}
        </PageFrame>
    );
}
