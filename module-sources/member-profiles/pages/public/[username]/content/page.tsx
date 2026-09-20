"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Card, CardContent, ListControls, Pagination, buttonClassName } from "@/core/sdk/ui";
import { useRelativeTime } from "@/core/sdk/ui";
import { CONTENT_KINDS, type ContentItem } from "../../../../lib/member-content";

interface PageProps {
    params: Promise<{ username: string }>;
}

interface Page {
    page: number;
    pages: number;
    total: number;
}

/** The kind the page opens on when the address names none. */
const DEFAULT_KIND = CONTENT_KINDS[0]?.kind ?? "topics";

/**
 * Everything one member has written, by kind.
 *
 * The profile counted five totals and led nowhere: a reader saw "42 posts" and
 * that was the end of it. Each of those counts is a link now, and this is the
 * page behind them - a list of the things themselves, each one a link to where
 * it actually lives, which is the trip somebody reading a profile is trying to
 * make.
 *
 * The kind is in the address, so a link to somebody's topics is a link to
 * somebody's topics rather than to a screen they then have to operate.
 */
export default function MemberContentPage({ params }: PageProps) {
    const { username } = use(params);
    const t = useTranslations("memberProfiles");
    const query = useSearchParams();
    const relativeTime = useRelativeTime();

    const asked = query.get("kind") ?? "";
    const kind = CONTENT_KINDS.some((k) => k.kind === asked) ? asked : DEFAULT_KIND;

    const [items, setItems] = useState<ContentItem[]>([]);
    const [paging, setPaging] = useState<Page>({ page: 1, pages: 1, total: 0 });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    // A different kind is a different list, so it starts at its own first page.
    useEffect(() => { setPage(1); }, [kind]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(`/api/v1/members/${encodeURIComponent(username)}/content?kind=${kind}&page=${page}`)
            .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then((data: { items?: ContentItem[]; pagination?: Page }) => {
                if (cancelled) return;
                setItems(data.items ?? []);
                setPaging(data.pagination ?? { page: 1, pages: 1, total: 0 });
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [username, kind, page]);

    const kindOptions = CONTENT_KINDS.map((k) => ({ value: k.kind, label: t(`stat_${k.kind}`) }));

    return (
        <PageFrame
            // The heading is what is being listed; the member is the crumb
            // above it. Both were the username, so the trail read
            // "Home / aeryn / aeryn".
            title={t(`stat_${kind}`)}
            trail={[{ label: username, href: `/u/${username}` }]}
        >
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <Link href={`/u/${username}`} className={buttonClassName("outline", "sm")}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t("backToProfile")}
                </Link>
                <ListControls
                    filters={[{
                        id: "kind",
                        label: t("contentKind"),
                        value: kind,
                        options: kindOptions,
                        // The kind is the address, so changing it is navigation.
                        onChange: (value) => { window.location.search = `?kind=${value}`; },
                    }]}
                />
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : failed || items.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {t("nothingOfThisKind")}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <ul className="space-y-2">
                        {items.map((item) => {
                            const body = (
                                <>
                                    <p className="font-medium text-foreground group-hover:text-primary">
                                        {item.title || t("untitled")}
                                    </p>
                                    {item.excerpt && (
                                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.excerpt}</p>
                                    )}
                                    <p className="mt-1 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</p>
                                </>
                            );
                            return (
                                <li key={item.id}>
                                    {item.href ? (
                                        <Link
                                            href={item.href}
                                            className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                                        >
                                            {body}
                                        </Link>
                                    ) : (
                                        // The thing it hung off is gone. Still
                                        // theirs, still counted, nowhere to go.
                                        <div className="rounded-xl border border-border bg-card p-4 opacity-70">{body}</div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    <Pagination
                        className="mt-4"
                        page={paging.page}
                        pages={paging.pages}
                        total={paging.total}
                        onPageChange={setPage}
                    />
                </>
            )}
        </PageFrame>
    );
}
