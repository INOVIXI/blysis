"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Pagination } from "@/core/components/ui/pagination";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import {
    Loader2,
    ChevronDown,
    ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/core/components/ui/native-select";
import { badgeClassName } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

/**
 * What a kind of thing is called, rather than how the code refers to it.
 *
 * A revision's `resource` is the recording module's own word - `forum.post`,
 * `blog.article` - and this screen printed it in monospace. That is a machine
 * name on a screen a person reads, which is the one thing the panel does not
 * do; the module that records the kind names it, under the key derived here.
 *
 * The raw string is the fallback, so a module that has not named its kind yet
 * shows something rather than nothing. `a-revision-says-what-changed` is what
 * stops that being the normal case.
 */
function revisionNameKey(resource: string): string {
    return `revision_${resource.replace(/\./g, "_")}`;
}

interface Revision {
    id: string;
    resource: string;
    resourceId: string;
    action: string;
    data: unknown;
    createdAt: string;
    author: { id: string; username: string } | null;
}

interface RevisionsResponse {
    revisions: Revision[];
    total: number;
    page: number;
    pages: number;
    resources: string[];
}

export default function RevisionsPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const revisionName = (resource: string) => {
        const key = revisionNameKey(resource);
        return t.has(key) ? t(key) : resource;
    };
    const [revisions, setRevisions] = useState<Revision[]>([]);
    const [resources, setResources] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [resourceFilter, setResourceFilter] = useState("");
    const [resourceIdFilter, setResourceIdFilter] = useState("");
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const fetchRevisions = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            if (resourceFilter) params.set("resource", resourceFilter);
            if (resourceIdFilter) params.set("resourceId", resourceIdFilter);
            const res = await fetch(`/api/v1/admin/revisions?${params.toString()}`);
            if (res.ok) {
                const data: RevisionsResponse = await res.json();
                setRevisions(data.revisions || []);
                setPages(data.pages || 1);
                setTotal(data.total || 0);
                if (data.resources && data.resources.length > 0) {
                    setResources(data.resources);
                }
            }
        } finally {
            setLoading(false);
        }
    }, [page, resourceFilter, resourceIdFilter]);

    useEffect(() => {
        fetchRevisions();
    }, [fetchRevisions]);

    const toggleExpand = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    /**
     * What happened, in words.
     *
     * It read DELETE and UPDATE in monospace capitals, which is the column
     * name in a database rather than a thing that happened to a forum post.
     * An action nobody has named shows its own word, because an audit trail
     * that hides an entry it does not recognise is worse than one that spells
     * it oddly.
     */
    const actionBadge = (action: string) => {
        const key = `revisions_action_${action}`;
        return (
            <span className={badgeClassName(action === "delete" ? "danger" : "info")}>
                {t.has(key) ? t(key) : action}
            </span>
        );
    };

    return (
        <>
            <AdminPageHeader
                title={t("revisions_title")}
                description={t("revisions_subtitle")}
            />

            <Card className="mb-4">
                <CardContent className="p-4 grid gap-3 md:grid-cols-2">
                    <div>
                        <Label>{t("revisions_filterResource")}</Label>
                        <NativeSelect
                            aria-label={t("revisions_filterResource")}
                            value={resourceFilter}
                            onChange={(e) => {
                                setPage(1);
                                setResourceFilter(e.target.value);
                            }} className="w-full"
                        >
                            <option value="">{t("revisions_allResources")}</option>
                            {resources.map((r) => (
                                <option key={r} value={r}>
                                    {revisionName(r)}
                                </option>
                            ))}
                        </NativeSelect>
                    </div>
                    <div>
                        <Label>{t("revisions_filterResourceId")}</Label>
                        <Input
                            aria-label={t("revisions_filterResourceId")}
                            value={resourceIdFilter}
                            onChange={(e) => {
                                setPage(1);
                                setResourceIdFilter(e.target.value);
                            }}
                            placeholder={t("revisions_resourceIdPlaceholder")}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : revisions.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {t("revisions_none")}
                        </p>
                    ) : (
                        <div className="divide-y">
                            {revisions.map((rev) => {
                                const isOpen = expanded.has(rev.id);
                                return (
                                    <div key={rev.id} className="hover:bg-muted/30">
                                        <button
                                            type="button"
                                            onClick={() => toggleExpand(rev.id)}
                                            className="w-full flex items-center gap-3 p-4 text-left"
                                        >
                                            {isOpen ? (
                                                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            ) : (
                                                <ChevronRightIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                                                <span className="truncate font-medium">
                                                    {revisionName(rev.resource)}
                                                </span>
                                                <span
                                                    className="font-mono text-xs text-muted-foreground truncate"
                                                    title={rev.resourceId}
                                                >
                                                    {rev.resourceId.length > 12
                                                        ? `${rev.resourceId.slice(0, 12)}…`
                                                        : rev.resourceId}
                                                </span>
                                                <span>{actionBadge(rev.action)}</span>
                                                <span className="text-xs text-muted-foreground truncate">
                                                    {rev.author?.username || t("revisions_system")}
                                                </span>
                                                <span className="text-xs text-muted-foreground text-right md:text-left">
                                                    {formatDateTime(rev.createdAt)}
                                                </span>
                                            </div>
                                        </button>
                                        {isOpen && (
                                            <div className="px-10 pb-4">
                                                <pre className="font-mono text-xs bg-muted/50 border border-border rounded p-3 overflow-x-auto max-h-96">
                                                    {JSON.stringify(rev.data, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
