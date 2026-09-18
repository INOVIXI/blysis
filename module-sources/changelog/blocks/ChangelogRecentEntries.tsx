"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ComponentConfig } from "@measured/puck";
import { LoadFailed, Waiting, useLocalDate } from "@/core/sdk/ui";

/**
 * Puck page-builder block: ChangelogRecentEntries
 * Renders the N most recent changelog entries in a compact timeline.
 * Data comes from the public changelog API.
 */

interface ChangelogRecentEntriesProps {
    count: number;
    heading: string;
    showDate: boolean;
}

interface ChangelogEntry {
    id: string;
    version: string;
    title: string;
    content: string;
    type: string;
    color?: string | null;
    createdAt: string;
}

function ChangelogRecentEntriesRender({ count, heading, showDate }: ChangelogRecentEntriesProps): React.ReactElement {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("changelog");
    const commonT = useTranslations("common");
    const [entries, setEntries] = useState<ChangelogEntry[]>([]);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/changelog?limit=${count || 5}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                const list: ChangelogEntry[] = Array.isArray(d) ? d : d.entries || d.data || [];
                setEntries(list.slice(0, count || 5));
                setFailed(false);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setFailed(true);
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [count, reloadKey]);

    return (
        <section className="container mx-auto px-4 py-8 max-w-3xl">
            {heading ? (
                <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6">{heading}</h2>
            ) : null}
            {loading ? (
                <Waiting label={commonT("loading")} className="h-24" />
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : entries.length === 0 ? (
                <div className="text-muted-foreground text-sm">{t("noEntries")}</div>
            ) : (
                <ul className="space-y-4">
                    {entries.map((entry) => (
                        <li
                            key={entry.id}
                            className="p-4 rounded-lg bg-card border border-border"
                        >
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span
                                    className="text-xs px-2 py-0.5 rounded font-medium text-white"
                                    style={{ backgroundColor: entry.color || "#3b82f6" }}
                                >
                                    {entry.type}
                                </span>
                                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-mono">
                                    v{entry.version}
                                </span>
                                {showDate ? (
                                    <span className="text-xs text-muted-foreground">
                                        {formatDate(entry.createdAt)}
                                    </span>
                                ) : null}
                            </div>
                            <h3 className="font-semibold text-foreground mb-1">{entry.title}</h3>
                            {entry.content ? (
                                <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                                    {entry.content}
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

const ChangelogRecentEntries: ComponentConfig<ChangelogRecentEntriesProps> = {
    fields: {
        count: { type: "number", label: "Number of entries", min: 1, max: 20 },
        heading: { type: "text", label: "Section heading" },
        showDate: {
            type: "radio",
            label: "Show dates",
            options: [
                { label: "Yes", value: true },
                { label: "No", value: false },
            ],
        },
    },
    defaultProps: {
        count: 5,
        heading: "Recent Updates",
        showDate: true,
    },
    render: ChangelogRecentEntriesRender,
};

export default ChangelogRecentEntries;
