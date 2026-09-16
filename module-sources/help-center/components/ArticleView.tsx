"use client";

import { useState } from "react";
import { RichContent } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { useTranslations } from "next-intl";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { PageFrame } from "@/core/sdk/layout";
import { toast } from "sonner";
import { writeError } from "@/core/sdk";

interface Article {
    id: string;
    title: string;
    slug: string;
    content: string;
    /** null when the site has turned view counts off. */
    views: number | null;
    helpful: number;
    notHelpful: number;
    category: { id: string; name: string; slug: string };
    settings?: { showViewCount: boolean; enableFeedback: boolean };
}

/**
 * The article, drawn from what the server already read.
 *
 * It used to fetch itself on mount, so no article ever reached the HTML the
 * server sent - all 30 the sitemap publishes were empty pages to a reader
 * without JavaScript. The server renders it now; the vote at the bottom is
 * still this component's job.
 */
export function ArticleView({
    slug,
    article,
    neighbours,
}: {
    slug: string;
    article: Article;
    neighbours: { id: string; slug: string; title: string }[];
}) {
    const t = useTranslations("helpCenter");
    const [feedbackGiven, setFeedbackGiven] = useState(false);
    const submitFeedback = async (helpful: boolean) => {
        if (feedbackGiven) return;

        const res = await fetch(`/api/v1/help/articles/${slug}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ helpful }),
        });
        // Thanking the reader for a vote the server dropped is worse than
        // asking them to try again: the vote is gone either way, and only one
        // of the two says so.
        const failed = await writeError(res, t("feedbackFailed"), t);
        if (failed) { toast.error(failed); return; }
        setFeedbackGiven(true);
    };

    return (
        <PageFrame
            title={article.title}
            trail={[
                { label: t("title"), href: "/help" },
                { label: article.category.name, href: `/help/category/${article.category.slug}` },
            ]}
            sidebar={(
                <nav aria-label={t("inThisCategory")} className="bg-card rounded-xl border border-border p-5">
                    <h2 className="font-bold text-foreground mb-4">{t("inThisCategory")}</h2>
                    <ul className="space-y-2">
                            {neighbours.map((entry) => (
                                <li key={entry.id}>
                                    <Link
                                        href={`/help/${entry.slug}`}
                                        aria-current={entry.slug === slug ? "page" : undefined}
                                        className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                                            entry.slug === slug
                                                ? "bg-muted font-medium text-foreground"
                                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                        }`}
                                    >
                                        {entry.title}
                                    </Link>
                                </li>
                            ))}
                    </ul>
                </nav>
            )}
        >
            {/* Nothing is loading and nothing is missing: the server answered
                both questions before this rendered, and an article that is not
                there is a 404 rather than a page saying so. */}
            <div>
                    <div className="bg-card rounded-xl border border-border p-8">
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6 pb-6 border-b">
                            <span>{t("articleCategory", { name: article.category.name })}</span>
                            {article.views !== null && (
                                <>
                                    <span>•</span>
                                    <span>{t("views", { count: article.views })}</span>
                                </>
                            )}
                        </div>

                        {/* Article Content */}
                        <RichContent
                            className="mb-8"
                            markdown={article.content}
                        />

                        {/* Feedback */}
                        {article.settings?.enableFeedback !== false && (
                        <div className="border-t pt-6">
                            <p className="font-medium text-foreground mb-3">{t("wasHelpful")}</p>
                            {feedbackGiven ? (
                                <p className="text-success">{t("feedbackThanks")}</p>
                            ) : (
                                <div className="flex gap-3">
                                    {/*
                                        Both of these asked for a hover colour
                                        identical to the resting one, so the
                                        only thing that moved when a pointer
                                        crossed them was nothing at all.
                                    */}
                                    <button
                                        onClick={() => submitFeedback(true)}
                                        className="px-4 py-2 bg-success/10 text-success rounded-lg hover:bg-success/20 transition-colors inline-flex items-center gap-2"
                                    >
                                        <ThumbsUp className="w-4 h-4" /> {t("helpfulYes")}
                                    </button>
                                    <button
                                        onClick={() => submitFeedback(false)}
                                        className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/70 transition-colors inline-flex items-center gap-2"
                                    >
                                        <ThumbsDown className="w-4 h-4" /> {t("helpfulNo")}
                                    </button>
                                </div>
                            )}
                        </div>
                        )}
                    </div>

                    {/* Related */}
                    <div className="mt-6 text-center">
                        <p className="text-muted-foreground mb-2">{t("stillNeedHelp")}</p>
                        <Link href="/support/new" className="text-primary hover:underline font-medium">
                            {t("createTicket")}
                        </Link>
                    </div>
                </div>
        </PageFrame>
    );
}
