"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Card, CardContent, LoadFailed, RichContent, useLocalDate } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { changelogTone, changelogTypeLabel } from "../../../../lib/types";
import { entryNumberFrom } from "../../../../lib/entry-page";

interface Entry {
    number: number;
    slug: string;
    version: string;
    title: string;
    content: string;
    details: string;
    coverImage?: string | null;
    type: string;
    createdAt: string;
}

/**
 * One release, at length.
 *
 * The timeline carries the summary and this carries whatever else there was to
 * say. Only entries with something more reach it: the endpoint answers 404
 * otherwise, so a visitor who guesses a number gets the not-found state rather
 * than a page repeating the line they just read.
 *
 * The catch-all route hands the segment over as `slug`, not as the parameter
 * name written in the manifest - the module page router matches on the path
 * and passes what it matched. Reading `params.number` here would leave the
 * page on its spinner forever, which is how this was got wrong once already
 * on another module's screen.
 */
export default function ChangelogEntryPage() {
    const t = useTranslations("changelog");
    const params = useParams();
    const formatLocalDate = useLocalDate();
    const [entry, setEntry] = useState<Entry | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "failed" | "missing">("loading");
    const [reloadKey, setReloadKey] = useState(0);

    const number = entryNumberFrom((params.slug ?? params.params) as string | string[] | undefined);

    useEffect(() => {
        if (!number) return;
        let cancelled = false;
        fetch(`/api/v1/changelog/entry/${encodeURIComponent(String(number))}`)
            .then(async (r) => {
                if (r.status === 404) return { missing: true as const };
                if (!r.ok) throw new Error("load failed");
                return r.json() as Promise<{ entry: Entry }>;
            })
            .then((d) => {
                if (cancelled) return;
                if ("missing" in d) { setState("missing"); return; }
                setEntry(d.entry);
                setState("ready");
            })
            .catch(() => { if (!cancelled) setState("failed"); });
        return () => { cancelled = true; };
    }, [number, reloadKey]);

    const back = (
        <Link href="/changelog" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
            <ArrowLeft className="w-4 h-4" /> {t("backToList")}
        </Link>
    );

    if (state === "loading") {
        return (
            <PageFrame title={t("title")} description={t("subtitle")}>
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            </PageFrame>
        );
    }

    if (state === "failed") {
        return (
            <PageFrame title={t("title")} description={t("subtitle")}>
                <LoadFailed onRetry={() => { setState("loading"); setReloadKey((k) => k + 1); }} />
            </PageFrame>
        );
    }

    if (state === "missing" || !entry) {
        return (
            <PageFrame title={t("title")} description={t("subtitle")}>
                <Card>
                    <CardContent className="py-12 text-center space-y-3">
                        <p className="text-muted-foreground">{t("entryMissing")}</p>
                        {back}
                    </CardContent>
                </Card>
            </PageFrame>
        );
    }

    return (
        <PageFrame title={entry.title} description={t("subtitle")}>
            <div className="space-y-6">
                {back}

                {entry.coverImage && (
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
                        <Image src={entry.coverImage} alt="" fill className="object-cover" sizes="(max-width: 768px) 100vw, 768px" />
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={changelogTone(entry.type)}>{changelogTypeLabel(t, entry.type)}</Badge>
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-mono">
                        v{entry.version}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatLocalDate(entry.createdAt)}</span>
                </div>

                {/* The summary is repeated once, above the long form, because a
                    reader arriving from a shared link has not seen the
                    timeline and would otherwise start halfway through. */}
                <Card>
                    <CardContent className="p-5 space-y-4">
                        <RichContent className="text-muted-foreground" markdown={entry.content} />
                        <div className="border-t border-border pt-4">
                            <RichContent markdown={entry.details} />
                        </div>
                    </CardContent>
                </Card>

                {back}
            </div>
        </PageFrame>
    );
}
