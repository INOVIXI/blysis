"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, RichContent } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Loader2 } from "lucide-react";
import { wasBuiltWithBlocks } from "../../../lib/validations";

/**
 * A custom page, as its author wrote it.
 *
 * This used to decide between two grammars on every render: parse the content,
 * and draw it with the block editor's renderer if it turned out to be that
 * editor's JSON, or as Markdown if it did not. The editor is gone, so there is
 * one grammar and nothing to decide - except for a page an installation wrote
 * with the old editor, which is recognised and said out loud rather than
 * poured at a reader as braces.
 */

interface PageProps {
    params: Promise<{ slug: string }>;
}

interface CustomPage {
    id: string;
    title: string;
    slug: string;
    content: string;
}

export default function CustomPageView({ params }: PageProps) {
    const t = useTranslations("customPages");
    const commonT = useTranslations("common");
    const { slug } = use(params);
    const [page, setPage] = useState<CustomPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/custom-pages/${slug}`)
            .then((r) => {
                if (cancelled) return;
                if (!r.ok) { setNotFound(true); setLoading(false); return null; }
                return r.json();
            })
            .then((d) => {
                if (cancelled) return;
                if (d) { setPage(d.page); setLoading(false); }
            })
            .catch(() => {
                if (cancelled) return;
                setNotFound(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [slug]);

    return (
        <PageFrame
            title={page?.title ?? commonT("loading")}
        >
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : notFound ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("pageNotFound")}</CardContent></Card>
            ) : page ? (
                <Card>
                    <CardContent className="p-8">
                        {wasBuiltWithBlocks(page.content) ? (
                            <p className="text-muted-foreground">{t("builtWithBlocks")}</p>
                        ) : (
                            // The title is the frame's. This used to draw it
                            // again underneath, so `/page/rules` was headed
                            // Rules twice.
                            <RichContent markdown={page.content} />
                        )}
                    </CardContent>
                </Card>
            ) : null}
        </PageFrame>
    );
}
