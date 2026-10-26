"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MessagesSquare } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { useRelativeTime } from "@/core/sdk/ui";

interface TopicRow {
    id: string;
    number: number;
    slug: string;
    title: string;
    createdAt: string;
    author: { username: string } | null;
    category: { name: string } | null;
    _count?: { posts: number };
}

/** Enough to say the forum is alive without becoming the forum. */
const SHOWN = 5;

/**
 * The forum's newest topics, for the homepage.
 *
 * Read through the forum's own topic list, so a private section's topics are
 * left out for a reader who may not open it and a topic waiting for a
 * moderator is not shown, exactly as on the forum page. Asked newest first:
 * the forum page puts pinned topics on top, which on a homepage would show
 * the same rules threads for ever.
 */
export function LatestTopicsWidget() {
    const t = useTranslations("forum");
    const relative = useRelativeTime();
    const [topics, setTopics] = useState<TopicRow[]>([]);

    useEffect(() => {
        let active = true;
        fetch(`/api/v1/forum/topics?order=newest&limit=${SHOWN}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { topics?: TopicRow[] } | null) => {
                if (active && Array.isArray(d?.topics)) setTopics(d.topics.slice(0, SHOWN));
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (topics.length === 0) return null;

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
                <MessagesSquare className="w-4 h-4 text-primary" />
                <h2 className="font-bold text-foreground">{t("widget_latestTitle")}</h2>
            </div>
            <ul className="space-y-3">
                {topics.map((topic) => (
                    <li key={topic.id}>
                        <Link href={`/forum/topic/${topic.number}/${topic.slug}`} className="block group">
                            <span className="block font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">{topic.title}</span>
                            <span className="block text-xs text-muted-foreground">
                                {t("widget_latestBy", { name: topic.author?.username ?? t("widget_latestNobody"), when: relative(topic.createdAt) })}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
            <Link href="/forum" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                {t("widget_latestAll")}
            </Link>
        </div>
    );
}
