"use client";

import { useEffect, useState } from "react";
import { Award, Check, Users } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { PageFrame } from "@/core/sdk/layout";
import { LoadFailed, Pagination, usePagedRows } from "@/core/sdk/ui";

interface TrophyRow {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    points: number;
    _count: { users: number };
}

interface EarnedRow {
    id: string;
    trophy: { id: string };
}

/**
 * The trophies, drawn from what the server already read.
 *
 * The list used to be fetched on mount, so the HTML the server sent carried
 * no trophy. The server reads it now; which of them this reader has earned is
 * still asked here, because that answer is one person's and must not be
 * written into a page anybody else may be served.
 */
export function TrophyGrid({ initial }: { initial: TrophyRow[] }) {
    const t = useTranslations("trophies");
    const { data: session } = useSession();
    const [trophies] = useState<TrophyRow[]>(initial);
    const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set());
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const paged = usePagedRows(trophies, 12);

    /*
     * Only the personal half is asked for here. The list itself came from the
     * server with the page; fetching it again would be a second read of the
     * same rows and a flash where the same content replaced itself.
     */
    useEffect(() => {
        if (!session?.user) return;
        let cancelled = false;
        fetch("/api/v1/me/trophies")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                const earned: EarnedRow[] = Array.isArray(d.earned) ? d.earned : [];
                setEarnedIds(new Set(earned.map((row) => row.trophy.id)));
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [session?.user, reloadKey]);

    return (
        <PageFrame
            title={t("pageTitle")}
            description={t("pageDesc")}
        >
            {/* The failure is the personal half's, and it sits above the list
                rather than in place of it. The trophies arrived with the page;
                replacing them with a panel threw away what the server had
                already sent to say that one extra read had not come back. */}
            {failed && <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />}
            {trophies.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    {t("noTrophiesAvailable")}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paged.rows.map((tr) => {
                        const earned = earnedIds.has(tr.id);
                        return (
                            <div
                                key={tr.id}
                                className={`relative rounded-lg border p-4 transition-colors ${earned ? "border-warning/40 bg-warning/5" : "border-border bg-card"
                                    }`}
                            >
                                {earned && (
                                    <span
                                        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-success/15 text-success text-xs px-2 py-0.5"
                                        title={t("earnedTitle")}
                                    >
                                        <Check className="w-3 h-3" /> {t("earned")}
                                    </span>
                                )}
                                <div className="flex items-start gap-3">
                                    <div
                                        className="w-12 h-12 rounded-full flex items-center justify-center text-white shrink-0"
                                        style={{ backgroundColor: tr.color || "#6366f1" }}
                                    >
                                        <Award className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h2 className="font-semibold truncate">{tr.name}</h2>
                                        {tr.description && (
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                {tr.description}
                                            </p>
                                        )}
                                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                            <span className="inline-flex items-center gap-1 font-medium text-warning">
                                                {t("pointsShort", { points: tr.points })}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Users className="w-3 h-3" />
                                                {tr._count.users}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {paged.pages > 1 && (
                <Pagination className="mt-6" page={paged.page} pages={paged.pages} total={paged.total} onPageChange={paged.setPage} />
            )}
        </PageFrame>
    );
}
