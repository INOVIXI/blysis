"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MessagesSquare } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { LoadFailed, Waiting, buttonClassName, useBlockText, useRelativeTime, type BlockProps } from "@/core/sdk/ui";

interface TopicRow {
    id: string;
    number: number;
    slug: string;
    title: string;
    createdAt: string;
    author: { username: string } | null;
    category: { name: string; color?: string | null } | null;
}

const SHOWN = 4;

/**
 * A section's colour is free text in the panel. Only a hex colour is drawn;
 * anything else is left to the theme rather than written into a style.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `forum.latest-topics`: the forum's newest topics as a card for a row of
 * cards, each with its section's colour and name beside who started it and
 * when, ending on a button into the forum. Read newest first from the
 * forum's own list, so a private section stays private exactly as there.
 *
 * Unlike the sidebar widget it stays when the forum is empty, saying so: a
 * card in a row of three that vanished would leave a hole in the row.
 */
export function LatestTopicsBlock({ settings }: BlockProps) {
    const t = useTranslations("forum");
    const commonT = useTranslations("common");
    const text = useBlockText();
    const relative = useRelativeTime();
    const [topics, setTopics] = useState<TopicRow[] | null>(null);
    // A read that did not come back is not an empty forum
    // (an-empty-screen-says-which-empty).
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        fetch(`/api/v1/forum/topics?order=newest&limit=${SHOWN}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d: { topics?: TopicRow[] }) => { if (active) setTopics((d.topics ?? []).slice(0, SHOWN)); })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [reloadKey]);

    const retry = () => {
        setFailed(false);
        setTopics(null);
        setReloadKey((k) => k + 1);
    };

    return (
        <div className="flex flex-col bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
                <MessagesSquare className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="font-bold text-foreground">{text(settings.title) || t("widget_latestTitle")}</h2>
            </div>
            {failed ? (
                <LoadFailed onRetry={retry} className="py-6" />
            ) : topics === null ? (
                <Waiting label={commonT("loading")} />
            ) : topics.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noTopics")}</p>
            ) : (
                <ul className="flex flex-col gap-3.5">
                    {topics.map((topic) => {
                        const colour = topic.category?.color && HEX.test(topic.category.color) ? topic.category.color : null;
                        return (
                            <li key={topic.id} className="flex gap-3">
                                <span
                                    data-topic-colour
                                    aria-hidden="true"
                                    className={`w-1.5 shrink-0 rounded-sm ${colour ? "" : "bg-primary"}`.trim()}
                                    style={colour ? { backgroundColor: colour } : undefined}
                                />
                                <span className="min-w-0">
                                    <Link href={`/forum/topic/${topic.number}/${topic.slug}`} className="block font-semibold leading-snug text-foreground hover:text-primary line-clamp-2">
                                        {topic.title}
                                    </Link>
                                    <span className="block text-xs text-muted-foreground">
                                        {t("blk_topicMeta", {
                                            name: topic.author?.username ?? t("widget_latestNobody"),
                                            section: topic.category?.name ?? "",
                                            when: relative(topic.createdAt),
                                        })}
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            <Link href="/forum" className={`${buttonClassName("outline", "default")} mt-5 w-full`}>
                {t("widget_latestAll")}
            </Link>
        </div>
    );
}
