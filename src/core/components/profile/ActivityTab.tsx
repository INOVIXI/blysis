"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { ListControls } from "@/core/components/ui/list-controls";
import { Pagination } from "@/core/components/ui/pagination";
import { ActivityFeedList, type ActivityItem } from "@/core/components/activity/ActivityFeedList";
import { activityTypeLabel } from "@/core/lib/activity-title";
import { useAllModules } from "@/core/providers/module-provider";

interface TypeFacet {
    type: string;
    count: number;
}

interface Page {
    page: number;
    pages: number;
    total: number;
}

/** What one page of a member's own history holds. */
const PER_PAGE = 20;

/**
 * A member's own history.
 *
 * It asked for fifty rows and drew all of them, which is a screen with no
 * bottom and no way in: an account with a year behind it could not reach
 * anything older, and finding one purchase among fifty entries meant reading
 * fifty entries. The server does the narrowing now - a term over the headline
 * and the excerpt, a kind picked from the kinds this account actually has -
 * and the pager is the one every other list uses.
 */
export function ActivityTab() {
    const t = useTranslations("profile");
    const activityT = useTranslations("activity");
    const modules = useAllModules();

    const [items, setItems] = useState<ActivityItem[]>([]);
    const [facets, setFacets] = useState<TypeFacet[]>([]);
    const [paging, setPaging] = useState<Page>({ page: 1, pages: 1, total: 0 });
    const [term, setTerm] = useState("");
    const [type, setType] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    // A narrower list is a shorter list, so the page the reader was on may not
    // exist under the new filter. Both reset it.
    const narrow = useCallback((change: () => void) => {
        setPage(1);
        change();
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const query = new URLSearchParams({
            scope: "mine",
            limit: String(PER_PAGE),
            page: String(page),
        });
        if (term) query.set("q", term);
        if (type) query.set("type", type);

        fetch(`/api/v1/activity-feed?${query}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d: { items?: ActivityItem[]; types?: TypeFacet[]; pagination?: Page }) => {
                if (cancelled) return;
                setItems(d.items || []);
                setFacets(d.types || []);
                setPaging(d.pagination ?? { page: 1, pages: 1, total: 0 });
            })
            .catch(() => {
                if (!cancelled) setItems([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [term, type, page]);

    const typeOptions = useMemo(
        () => [
            { value: "", label: t("allActivityKinds") },
            ...facets.map((facet) => ({
                value: facet.type,
                label: `${activityTypeLabel(facet.type, activityT)} (${facet.count})`,
            })),
        ],
        [facets, t, activityT],
    );

    const filtering = term !== "" || type !== "";

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("myActivity")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <ListControls
                    search={{ value: term, onChange: (value) => narrow(() => setTerm(value)), placeholder: t("searchActivity") }}
                    filters={[{
                        id: "type",
                        label: t("activityKind"),
                        value: type,
                        options: typeOptions,
                        onChange: (value) => narrow(() => setType(value)),
                    }]}
                />

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <ActivityFeedList
                            items={items}
                            moduleStates={modules}
                            emptyMessage={filtering ? t("noMatchingActivity") : t("noRecentActivity")}
                        />
                        <Pagination
                            page={paging.page}
                            pages={paging.pages}
                            total={paging.total}
                            onPageChange={setPage}
                        />
                    </>
                )}
            </CardContent>
        </Card>
    );
}
