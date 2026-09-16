"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { ArrowLeft, Download, FileText, Loader2 } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, LoadFailed, RichContent, useLocalDate } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { downloadNumberFrom, formatFileSize } from "../../../../lib/guide";

interface GuidedFile {
    id: string;
    number: number;
    slug: string;
    title: string;
    description: string | null;
    details: string;
    coverImage: string | null;
    fileName: string;
    fileSize: number | null;
    downloads: number;
    updatedAt: string;
}

/**
 * One download, with the instructions that make it usable.
 *
 * A launcher or a mod pack is rarely self-explanatory, and the list has room
 * for one line. Only files carrying a guide reach this page: the endpoint
 * answers 404 otherwise and the route's resolver makes that a real 404 rather
 * than a page rendered under a 200.
 *
 * The button here goes through the same endpoint the list's does, so the count
 * means one thing wherever somebody takes the file. Reading the instructions
 * is not taking it and is not counted.
 */
export default function DownloadGuidePage() {
    const t = useTranslations("downloads");
    const params = useParams();
    const formatLocalDate = useLocalDate();
    const [file, setFile] = useState<GuidedFile | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "failed" | "missing">("loading");
    const [reloadKey, setReloadKey] = useState(0);

    const number = downloadNumberFrom((params.slug ?? params.params) as string | string[] | undefined);

    useEffect(() => {
        if (!number) { setState("missing"); return; }
        let cancelled = false;
        fetch(`/api/v1/downloads/guide/${encodeURIComponent(number)}`)
            .then(async (r) => {
                if (r.status === 404) return { missing: true as const };
                if (!r.ok) throw new Error("load failed");
                return r.json() as Promise<{ download: GuidedFile }>;
            })
            .then((d) => {
                if (cancelled) return;
                if ("missing" in d) { setState("missing"); return; }
                setFile(d.download);
                setState("ready");
            })
            .catch(() => { if (!cancelled) setState("failed"); });
        return () => { cancelled = true; };
    }, [number, reloadKey]);

    const take = async () => {
        if (!file) return;
        const res = await fetch(`/api/v1/downloads/${file.id}`);
        if (!res.ok) return;
        const { url } = (await res.json()) as { url?: string };
        if (url) window.location.href = url;
    };

    const back = (
        <Link href="/downloads" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
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

    if (state === "missing" || !file) {
        return (
            <PageFrame title={t("title")} description={t("subtitle")}>
                <Card>
                    <CardContent className="py-12 text-center space-y-3">
                        <p className="text-muted-foreground">{t("guideMissing")}</p>
                        {back}
                    </CardContent>
                </Card>
            </PageFrame>
        );
    }

    return (
        <PageFrame title={file.title} description={t("subtitle")}>
            <div className="space-y-6">
                {back}

                {file.coverImage && (
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
                        <Image src={file.coverImage} alt="" fill className="object-cover" sizes="(max-width: 768px) 100vw, 768px" />
                    </div>
                )}

                {/* The file's own facts and the button, above the instructions:
                    somebody who already knows what this is should not have to
                    read past a tutorial to get it. */}
                <Card>
                    <CardContent className="p-4 flex flex-wrap items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText className="w-6 h-6 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground break-all">{file.fileName}</p>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span>{formatFileSize(file.fileSize, t("unknownSize"))}</span>
                                <span>{t("downloadsCount", { count: file.downloads })}</span>
                                <span>{formatLocalDate(file.updatedAt)}</span>
                            </div>
                        </div>
                        <Button onClick={take}>
                            <Download className="w-4 h-4" /> {t("downloadAction")}
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-5 space-y-4">
                        {file.description && (
                            <RichContent className="text-muted-foreground" markdown={file.description} />
                        )}
                        <div className={file.description ? "border-t border-border pt-4" : ""}>
                            <RichContent markdown={file.details} />
                        </div>
                    </CardContent>
                </Card>

                {back}
            </div>
        </PageFrame>
    );
}
