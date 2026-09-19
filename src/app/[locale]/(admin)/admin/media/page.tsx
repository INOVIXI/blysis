"use client";

import { useEffect, useState } from "react";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { Checkbox } from "@/core/components/ui/checkbox";
import { BulkBar } from "@/core/components/admin/BulkBar";
import { useRowPicks } from "@/core/hooks/useRowList";
import { deleteEach } from "@/core/lib/bulk-delete";
import { Input } from "@/core/components/ui/input";
import { Loader2, FileText, Trash2, Upload, X, Search, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { NativeSelect } from "@/core/components/ui/native-select";
import { copyText } from "@/core/lib/copy-text";
import { cn } from "@/core/lib/utils";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";

interface MediaItem {
    id: string;
    filename: string;
    url: string;
    mimeType: string;
    size: number;
    alt: string | null;
    createdAt: string;
    uploadedBy?: { username: string } | null;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaLibraryPage() {
    const [items, setItems] = useState<MediaItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState("");
    const [type, setType] = useState<"" | "image" | "document">("");
    const [selected, setSelected] = useState<MediaItem | null>(null);
    const [uploading, setUploading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    // A library is the one screen here that reaches thousands of rows, and
    // clearing out last year's uploads one confirmation at a time is why
    // nobody ever does it.
    const picks = useRowPicks(items);
    const { confirm } = useConfirm();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");

    const fetchItems = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                perPage: "24",
            });
            if (search) params.set("search", search);
            if (type) params.set("type", type);
            const res = await fetch(`/api/v1/media?${params}`);
            const data = await res.json();
            setItems(data.items || []);
            setTotalPages(data.totalPages || 1);
            setTotal(data.total || 0);
        } catch {
            toast.error(t("media_loadFailed"));
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchItems(); }, [page, type]);

    // Escape to close, Tab kept inside the panel, and focus handed back to the
    // thumbnail that opened it.
    const detailRef = useModalDialog<HTMLDivElement>(selected !== null, () => setSelected(null));

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        fetchItems();
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/v1/upload", { method: "POST", body: fd });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("media_uploadFailed"), t));
                return;
            }
            toast.success(t("media_uploaded"));
            setPage(1);
            fetchItems();
        } catch {
            toast.error(t("media_uploadFailed"));
        } finally {
            setUploading(false);
        }
    };

    const deleteItem = async (item: MediaItem) => {
        const ok = await confirm({
            title: t("media_deleteTitle"),
            message: t("media_deleteConfirm", { filename: item.filename }),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/media/${item.id}`, { method: "DELETE" });
        if (res.ok) {
            toast.success(t("media_deleted"));
            if (selected?.id === item.id) setSelected(null);
            fetchItems();
        } else {
            toast.error(t("media_deleteFailed"));
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("media_deleteTitle"),
            message: t("media_deleteManyConfirm", { count: picks.picked.size }),
            variant: "danger",
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/media/${id}`, { method: "DELETE" });
            return res.ok;
        });
        if (selected && picks.picked.has(selected.id)) setSelected(null);
        picks.clear();
        fetchItems();
        if (deleted === total) toast.success(t("media_deleted"));
        else if (deleted === 0) toast.error(t("media_deleteFailed"));
        else toast.error(t("crud_deletedPartly", { deleted, total }));
    };

    const updateItem = async (id: string, data: Partial<MediaItem>) => {
        const res = await fetch(`/api/v1/media/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (res.ok) {
            const updated = await res.json();
            setItems(items.map((i) => (i.id === id ? { ...i, ...updated } : i)));
            if (selected?.id === id) setSelected({ ...selected, ...updated });
            toast.success(t("media_updated"));
        }
    };

    const copyUrl = async (item: MediaItem) => {
        if (!(await copyText(item.url))) return;
        setCopiedId(item.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const isImage = (mime: string) => mime.startsWith("image/");

    return (
        <>
            <AdminPageHeader
                title={t("media_title")}
                description={t("media_subtitle")}
                actions={
                    /* A file input cannot be a <Button>: the picker only opens
                       from the input itself or a <label> pointing at it. So the
                       label wears the button's own classes rather than a
                       hand-rolled imitation of them, which is how this one came
                       to be a different height and a different radius from every
                       other button on the panel. */
                    <label className={cn(buttonClassName("default"), uploading && "pointer-events-none opacity-50")}>
                        <input type="file" className="sr-only" onChange={handleUpload} disabled={uploading} />
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? t("media_uploading") : t("media_upload")}
                    </label>
                }
            />

            <Card className="mb-4">
                <CardContent className="p-4 flex flex-wrap gap-3">
                    <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[16rem]">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t("media_searchPlaceholder")} aria-label={t("media_searchPlaceholder")}
                                className="pl-9"
                            />
                        </div>
                        <Button type="submit" variant="outline">{t("media_search")}</Button>
                    </form>
                    <NativeSelect
                        value={type}
                        onChange={(e) => { setType(e.target.value as "" | "image" | "document"); setPage(1); }}
                        aria-label={t("media_type")}
                        className="sm:w-52"
                    >
                        <option value="">{t("media_allTypes")}</option>
                        <option value="image">{t("media_images")}</option>
                        <option value="document">{t("media_documents")}</option>
                    </NativeSelect>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">
                    {t("media_noItems")}
                </CardContent></Card>
            ) : (
                <>
                <BulkBar
                    className="mb-4 rounded-lg border border-border"
                    state={picks.headerState}
                    count={picks.picked.size}
                    onToggleAll={picks.toggleAll}
                    actions={
                        <Button variant="destructive" size="sm" onClick={deleteMany}>
                            <Trash2 className="w-4 h-4" /> {commonT("delete")} {picks.picked.size}
                        </Button>
                    }
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                    {items.map((item) => (
                        /* The tile is a button, so the box cannot be inside
                           it: a control inside a control is a control a
                           keyboard cannot reach separately. It sits over the
                           corner instead. */
                        <div key={item.id} className="relative">
                        <Checkbox
                            className="absolute left-2 top-2 z-10 bg-card"
                            checked={picks.picked.has(item.id)}
                            onChange={() => picks.toggle(item.id)}
                            aria-label={t("common_selectRow")}
                        />
                        <button
                            type="button"
                            onClick={() => setSelected(item)}
                            title={item.filename}
                            className="group block w-full text-left rounded-lg border border-border bg-card overflow-hidden transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                            <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                                {isImage(item.mimeType) ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                        src={item.url}
                                        alt={item.alt || ""}
                                        // `contain` rather than `cover`: this is a
                                        // library, and a cropped thumbnail of a
                                        // wide banner is not the banner.
                                        className="w-full h-full object-contain"
                                    />
                                ) : (
                                    <FileText className="w-10 h-10 text-muted-foreground" />
                                )}
                            </div>
                            {/* The name used to appear only on hover, over a
                                fixed black strip, which a touch screen never
                                shows and a dark theme never matched. */}
                            <div className="px-2.5 py-2 border-t border-border">
                                <p className="text-xs truncate">{item.filename}</p>
                                <p className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</p>
                            </div>
                        </button>
                        </div>
                    ))}
                </div>
                </>
            )}

            <Pagination page={page} pages={totalPages} total={total} onPageChange={setPage} className="mt-6" />

            {/* Detail panel */}
            {selected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
                    <div className="fixed inset-0 bg-black/50" onClick={() => setSelected(null)} aria-hidden="true" />
                    <div
                        ref={detailRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="media-detail-title"
                        className="relative bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h2 id="media-detail-title" className="font-bold truncate">{selected.filename}</h2>
                            <button onClick={() => setSelected(null)} aria-label={commonT("close")} className="text-muted-foreground hover:text-foreground">
                                <X className="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            {isImage(selected.mimeType) ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={selected.url} alt={selected.alt || ""} className="w-full max-h-96 object-contain rounded" />
                            ) : (
                                <div className="flex items-center justify-center py-12 bg-muted rounded">
                                    <FileText className="w-16 h-16 text-muted-foreground" />
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <div className="text-muted-foreground text-xs">{t("media_size")}</div>
                                    <div>{formatBytes(selected.size)}</div>
                                </div>
                                <div>
                                    <div className="text-muted-foreground text-xs">{t("media_type")}</div>
                                    <div className="font-mono text-xs">{selected.mimeType}</div>
                                </div>
                                <div className="col-span-2">
                                    <div className="text-muted-foreground text-xs">{t("media_url")}</div>
                                    <div className="flex gap-2">
                                        <Input value={selected.url} readOnly aria-label={t("media_url")} className="text-xs font-mono" />
                                        <Button aria-label={commonT("copy")} variant="outline" size="sm" onClick={() => copyUrl(selected)}>
                                            {copiedId === selected.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                        </Button>
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <div className="text-muted-foreground text-xs mb-1">{t("media_altText")}</div>
                                    <Input
                                        value={selected.alt || ""}
                                        onChange={(e) => setSelected({ ...selected, alt: e.target.value })}
                                        onBlur={(e) => updateItem(selected.id, { alt: e.target.value })}
                                        placeholder={t("media_altPlaceholder")} aria-label={t("media_altText")}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <Button variant="destructive" size="sm" onClick={() => deleteItem(selected)}>
                                    <Trash2 className="w-4 h-4" /> {t("common_delete")}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
