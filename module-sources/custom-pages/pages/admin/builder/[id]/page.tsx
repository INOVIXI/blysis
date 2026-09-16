"use client";

import { useEffect, useState, use } from "react";
import { Link, useRouter } from "@/core/sdk/navigation";
import { Button, buttonClassName } from "@/core/sdk/ui";
import { useMergedBlockConfig } from "@/core/sdk/blocks";
import dynamic from "next/dynamic";
import type { Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { ArrowLeft, Loader2, Save, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface PageProps {
    params: Promise<{ id: string; locale: string }>;
}

/**
 * The editor itself, fetched when somebody opens it.
 *
 * Imported plainly, it travelled with every module admin screen on the site:
 * core renders them all through one catch-all route, and Next collects a
 * route's client references by walking its whole module graph. Measured on a
 * production build, 87.5 KB gzipped on the announcements screen, the SEO
 * screen, the ticket queue - for an editor only this page opens.
 *
 * `ssr: false` costs nothing: this page already loads the page it is editing
 * in the browser, so the server has never rendered any of it.
 */
const Puck = dynamic(() => import("@measured/puck").then((mod) => mod.Puck), {
    ssr: false,
});

export default function PageBuilderPage(props: PageProps) {
    const params = use(props.params);
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const router = useRouter();
    const pageId = params.id;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState<Data | null>(null);
    const [pageTitle, setPageTitle] = useState("");
    const [pageSlug, setPageSlug] = useState("");
    // Core blocks plus every installed module's, minus the palette entries of
    // modules the admin has switched off.
    const blockConfig = useMergedBlockConfig("edit", () => {
        toast.error(t("pageBuilder_loadFailed"));
    });

    useEffect(() => {
        let cancelled = false;
        if (pageId === "new") {
            // Empty starter
            setData({ root: { props: {} }, content: [] } as unknown as Data);
            setPageTitle("New Page");
            setLoading(false);
            return;
        }

        fetch(`/api/v1/custom-pages/${pageId}`)
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                if (!d.page) {
                    toast.error(t("pageBuilder_notFound"));
                    return;
                }
                setPageTitle(d.page.title);
                setPageSlug(d.page.slug);
                // Try to parse content as Puck JSON; fall back to empty editor
                try {
                    const parsed = JSON.parse(d.page.content || "");
                    if (parsed && typeof parsed === "object" && Array.isArray(parsed.content)) {
                        setData(parsed as Data);
                    } else {
                        setData({ root: { props: {} }, content: [] } as unknown as Data);
                    }
                } catch {
                    // Content is HTML, not Puck JSON - start with empty builder
                    setData({ root: { props: {} }, content: [] } as unknown as Data);
                }
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [pageId, t]);

    const save = async (puckData: Data) => {
        setSaving(true);
        try {
            const content = JSON.stringify(puckData);
            const url = pageId === "new" ? "/api/v1/custom-pages" : `/api/v1/custom-pages/${pageId}`;
            const method = pageId === "new" ? "POST" : "PATCH";
            const body = pageId === "new"
                ? { title: pageTitle, content, isActive: true }
                : { content };

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                toast.error(t("pageBuilder_saveFailed"));
                return;
            }
            toast.success(t("pageBuilder_saved"));
            if (pageId === "new") {
                const created = await res.json();
                router.replace(`/admin/page-builder/${created.page?.id || created.id}`);
            }
        } catch {
            toast.error(t("pageBuilder_error"));
        } finally {
            setSaving(false);
        }
    };

    if (loading || !data || !blockConfig) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-30 flex flex-col bg-background lg:left-64">
            {/* Top bar */}
            <div className="flex items-center gap-4 px-4 py-3 border-b border-border flex-shrink-0">
                <Link
                    href="/admin/custom-pages"
                    aria-label={commonT("back")}
                    className={buttonClassName("ghost", "icon")}
                >
                    <ArrowLeft className="w-4 h-4" />
                </Link>
                <div className="flex-1 min-w-0">
                    <h1 className="font-bold truncate">{pageTitle}</h1>
                    {pageSlug && (
                        <Link href={`/page/${pageSlug}`} target="_blank" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                            /page/{pageSlug} <ExternalLink className="w-3 h-3" />
                        </Link>
                    )}
                </div>
                <Button onClick={() => save(data)} disabled={saving}>
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("pageBuilder_saving")}</> : <><Save className="w-4 h-4" /> {t("pageBuilder_save")}</>}
                </Button>
            </div>

            {/* Puck editor fills the rest */}
            <div className="flex-1 min-h-0 puck-wrapper">
                <Puck
                    config={blockConfig}
                    data={data}
                    onPublish={save}
                    onChange={(d) => setData(d)}
                />
            </div>

            <style jsx global>{`
                .puck-wrapper > div { height: 100%; }
                .puck-wrapper ._Puck { height: 100%; }
            `}</style>
        </div>
    );
}
