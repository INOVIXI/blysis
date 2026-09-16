"use client";

import { useState, useEffect, use } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import type { Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { Card, CardContent, RichContent } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { useMergedBlockConfig } from "@/core/sdk/blocks";
import { Loader2 } from "lucide-react";

/**
 * The page builder's renderer, fetched when a built page is actually shown.
 *
 * Imported plainly, it travelled with every module page on the site: core
 * renders module pages through one catch-all route, Next collects a route's
 * client references by walking its whole module graph, and this file is in
 * that graph. Measured on a production build, 87.5 KB gzipped on `/store`,
 * `/forum`, `/leaderboard` and every other module page, for a library only
 * `/page/<slug>` ever calls.
 *
 * `ssr: false` costs nothing here: this page already fetches its content in
 * the browser, so the server has never rendered any of it.
 */
const Render = dynamic(() => import("@measured/puck").then((mod) => mod.Render), {
    ssr: false,
});

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
                <PageContent page={page} />
            ) : null}
        </PageFrame>
    );
}

/**
 * Render page content as either Puck blocks (if content parses to valid
 * Puck data) or sanitized HTML (legacy/fallback).
 */
function PageContent({ page }: { page: CustomPage }) {
    // A block whose module is off is not in this config, and Puck renders
    // nothing for a component id it does not carry.
    const blockConfig = useMergedBlockConfig("render");

    let puckData: Data | null = null;
    try {
        const parsed = JSON.parse(page.content || "");
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.content)) {
            puckData = parsed as Data;
        }
    } catch {
        // Not JSON - fall through to HTML render
    }

    if (puckData) {
        if (!blockConfig) {
            return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
        }
        return (
            <div>
                <h1 className="text-3xl font-bold text-foreground mb-6">{page.title}</h1>
                <Card>
                    <CardContent className="p-0 overflow-hidden">
                        <Render config={blockConfig} data={puckData} />
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-3xl font-bold text-foreground mb-6">{page.title}</h1>
            <Card>
                <CardContent className="p-8">
                    <RichContent
                        markdown={page.content}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
