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

    const actionBadge = (action: string) => {
        return (
            <span className={badgeClassName(action === "delete" ? "danger" : "info", "uppercase font-mono")}>
                {action}
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
                                    {r}
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
                                                <span className="font-mono text-xs truncate" title={rev.resource}>
                                                    {rev.resource}
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
