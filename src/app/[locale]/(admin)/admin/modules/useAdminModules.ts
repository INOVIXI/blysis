"use client";

/**
 * All state and side effects for the admin modules screen.
 *
 * Extracted so `page.tsx` is the markup and this is the behaviour. The screen
 * juggles two catalogues (installed and marketplace), eight independent
 * in-flight flags and six filters; interleaved with 300 lines of JSX, neither
 * half was readable.
 *
 * It returns a flat bag rather than a nested one on purpose - the component
 * destructures it, so the shape stays a rename away from any change instead of
 * a second layer to keep in sync.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useTranslations, useLocale } from "next-intl";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { compareVersions } from "./module-display";
import type { Module, MarketplaceModule, SortKey } from "./types";
import { dateLocaleTag } from "@/core/lib/utils";
import { errorMessage } from "@/core/lib/write-result";
import { moduleDescription, moduleName } from "@/core/lib/module-label";

export function useAdminModules() {
    const t = useTranslations("admin");
    const __locale = useLocale();
    const __dateTag = dateLocaleTag(__locale);
    const searchParams = useSearchParams();
    const initialFilterParam = searchParams?.get("filter") ?? null;

    const [modules, setModules] = useState<Module[]>([]);
    const [marketplace, setMarketplace] = useState<MarketplaceModule[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMarketplace, setLoadingMarketplace] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [installing, setInstalling] = useState<string | null>(null);
    const [installProgress, setInstallProgress] = useState<{ name: string; step: string } | null>(null);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [updatingModule, setUpdatingModule] = useState<string | null>(null);

    const isBusy = installing !== null || uploading || deleting !== null || updatingModule !== null;
    const [marketplaceFilter, setMarketplaceFilter] = useState<string>("all");
    const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
    const [bulkInstalling, setBulkInstalling] = useState(false);
    const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; name: string } | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>("newest");
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
    const [updatesOnly, setUpdatesOnly] = useState<boolean>(initialFilterParam === "updates");
    const [detailModule, setDetailModule] = useState<MarketplaceModule | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { confirm } = useConfirm();

    const fetchModules = () => {
        fetch("/api/v1/modules")
            .then(res => res.json())
            .then(data => { setModules(data.modules || []); setLoading(false); })
            .catch(() => setLoading(false));
    };

    const fetchMarketplace = () => {
        fetch("/api/v1/modules/marketplace")
            .then(res => res.json())
            .then(data => { setMarketplace(data.modules || []); setLoadingMarketplace(false); })
            .catch(() => setLoadingMarketplace(false));
    };

    useEffect(() => { fetchModules(); fetchMarketplace(); }, []);

    const installedIds = useMemo(() => new Set(modules.map((m) => m.id)), [modules]);
    const marketplaceById = useMemo(() => {
        const map = new Map<string, MarketplaceModule>();
        for (const m of marketplace) map.set(m.id, m);
        return map;
    }, [marketplace]);

    // Compute updateAvailable client-side by comparing installed versions to
    // the marketplace. This overrides anything the /api/v1/modules returned.
    const modulesWithUpdates = useMemo(() => {
        return modules.map((mod) => {
            const mp = marketplaceById.get(mod.id);
            if (!mp) return mod;
            const hasUpdate = compareVersions(mp.version, mod.version) > 0;
            return { ...mod, updateAvailable: hasUpdate, latestVersion: mp.version };
        });
    }, [modules, marketplaceById]);

    const updatesAvailableCount = useMemo(
        () => modulesWithUpdates.filter((m) => m.updateAvailable).length,
        [modulesWithUpdates],
    );

    /**
     * Save one module's settings. The values are checked against the module's
     * own declarations on the server, so a bad field comes back as a message
     * rather than being stored.
     */
    const toggleModule = async (moduleId: string, enabled: boolean) => {
        setUpdating(moduleId);
        try {
            const res = await fetch("/api/v1/modules", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ moduleId, enabled }),
            });
            const data = await res.json();
            if (res.ok) {
                setModules(modules.map(m => m.id === moduleId ? { ...m, enabled } : m));
                toast.success(`${moduleId} ${enabled ? t("modules_enable") : t("modules_disable")}`);
            } else {
                toast.error(errorMessage(data, t("modules_toggleFailed"), t));
            }
        } catch { toast.error(t("modules_networkError")); }
        finally { setUpdating(null); }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (isBusy) { toast.error(t("modules_pleaseWait")); return; }
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch("/api/v1/modules/upload", { method: "POST", body: formData });
            const data = await res.json();
            if (res.ok) { toast.success(t("modules_uploadedToast", { name: data.module?.name ?? "" })); fetchModules(); }
            else toast.error(errorMessage(data, t("modules_uploadFailed"), t));
        } catch { toast.error(t("modules_uploadFailed")); }
        finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
    };

    const handleDelete = async (moduleId: string, moduleName: string) => {
        if (isBusy) { toast.error(t("modules_pleaseWait")); return; }
        const ok = await confirm({ title: t("modules_deleteTitle"), message: t("modules_deleteConfirm", { name: moduleName }), variant: "danger", confirmText: t("common_delete") });
        if (!ok) return;
        setDeleting(moduleId);
        try {
            const res = await fetch(`/api/v1/modules/${moduleId}`, { method: "DELETE" });
            const data = await res.json();
            if (res.ok) { toast.success(t("modules_deletedToast", { name: moduleName })); fetchModules(); }
            else toast.error(errorMessage(data, t("modules_deleteFailed"), t));
        } catch { toast.error(t("modules_deleteFailed")); }
        finally { setDeleting(null); }
    };

    const handleUpdate = async (mod: Module) => {
        if (isBusy) { toast.error(t("modules_pleaseWait")); return; }
        const mpMod = marketplace.find(m => m.id === mod.id);
        if (!mpMod) { toast.error(t("modules_notFound")); return; }
        setUpdatingModule(mod.id);
        try {
            const res = await fetch("/api/v1/modules/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ moduleId: mod.id, zipFile: mpMod.zip }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(t("modules_updatedToast", { name: mod.name, version: data.module?.version ?? mpMod.version }));
                fetchModules();
            } else {
                toast.error(errorMessage(data, t("modules_updateFailed"), t));
            }
        } catch { toast.error(t("modules_updateFailed")); }
        finally { setUpdatingModule(null); }
    };

    const handleMarketplaceInstall = async (mod: MarketplaceModule) => {
        if (isBusy) {
            toast.error(t("modules_pleaseWait"));
            return;
        }
        const ok = await confirm({ title: t("modules_installTitle"), message: t("modules_installConfirm", { name: mod.name, version: mod.version }), confirmText: t("common_install") });
        if (!ok) return;
        setInstalling(mod.id);
        setInstallProgress({ name: mod.name, step: t("modules_stepDownloading") });
        try {
            setInstallProgress({ name: mod.name, step: t("modules_stepInstalling") });
            const res = await fetch("/api/v1/modules/marketplace/install", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ moduleId: mod.id, zipFile: mod.zip }),
            });
            const data = await res.json();
            if (res.ok) {
                setInstallProgress({ name: mod.name, step: t("modules_stepDone") });
                toast.success(t("modules_installedToast", { name: mod.name }));
                fetchModules();
                fetchMarketplace();
            } else {
                toast.error(errorMessage(data, t("modules_installFailed"), t));
            }
        } catch { toast.error(t("modules_installFailed")); }
        finally {
            setTimeout(() => { setInstalling(null); setInstallProgress(null); }, 500);
        }
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedModules);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedModules(next);
    };

    const toggleTag = (tag: string) => {
        const next = new Set(selectedTags);
        if (next.has(tag)) next.delete(tag); else next.add(tag);
        setSelectedTags(next);
    };

    const handleBulkInstall = async () => {
        const toInstall = marketplace.filter(m => selectedModules.has(m.id) && !installedIds.has(m.id));
        if (toInstall.length === 0) return;

        const ok = await confirm({
            title: t("modules_bulkInstall"),
            message: t("modules_bulkConfirm", { count: toInstall.length }),
            confirmText: t("modules_bulkInstall"),
        });
        if (!ok) return;

        setBulkInstalling(true);
        setBulkProgress({ current: 0, total: toInstall.length, name: t("modules_stepPreparing") });

        try {
            const res = await fetch("/api/v1/modules/marketplace/bulk-install", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    modules: toInstall.map(m => ({ id: m.id, zip: m.zip, name: m.name })),
                }),
            });
            const data = await res.json();

            if (res.ok) {
                toast.success(t("modules_bulkResult", { installed: data.installed, total: data.total }));
                // The server pulls in dependencies the operator did not tick,
                // so `total` can exceed what they selected. Say which.
                const autoAdded: string[] = data.autoAdded ?? [];
                if (autoAdded.length > 0) {
                    toast.info(t("modules_bulkAutoAdded", { names: autoAdded.join(", ") }));
                }
                if (data.failed > 0) {
                    const failedNames = data.results.filter((r: { status: string }) => r.status === "failed").map((r: { name: string }) => r.name).join(", ");
                    toast.error(t("modules_bulkFailedList", { names: failedNames }));
                }
            } else {
                toast.error(errorMessage(data, t("modules_bulkFailed"), t));
            }
        } catch {
            toast.error(t("modules_bulkFailed"));
        }

        setSelectedModules(new Set());
        setBulkInstalling(false);
        setBulkProgress(null);
        fetchModules();
        fetchMarketplace();
    };

    const filteredMarketplace = useMemo(() => {
        let list = marketplace.filter((m) => !installedIds.has(m.id));
        if (marketplaceFilter !== "all") list = list.filter((m) => m.category === marketplaceFilter);
        if (selectedTags.size > 0) {
            list = list.filter((m) => (m.tags || []).some((tag) => selectedTags.has(tag)));
        }

        const sorted = [...list];
        switch (sortKey) {
            case "newest":
                sorted.sort((a, b) => {
                    const ad = a.updatedAt ? Date.parse(a.updatedAt) : 0;
                    const bd = b.updatedAt ? Date.parse(b.updatedAt) : 0;
                    return bd - ad;
                });
                break;
            case "alphabetical":
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }
        return sorted;
    }, [marketplace, installedIds, marketplaceFilter, selectedTags, sortKey]);

    const categories = useMemo(
        () => Array.from(new Set(marketplace.map((m) => m.category))).sort(),
        [marketplace],
    );

    const allTags = useMemo(() => {
        const set = new Set<string>();
        for (const m of marketplace) for (const tag of m.tags || []) set.add(tag);
        return Array.from(set).sort();
    }, [marketplace]);

    /*
     * Eighty-nine cards in one ungrouped wall, and the only way to reach one
     * was to read them all. The term is matched against what a card actually
     * shows - the name and the description in the reader's language - rather
     * than against the id, because the id is not on the card.
     */
    const [search, setSearch] = useState("");

    const installedToShow = useMemo(() => {
        const base = updatesOnly
            ? modulesWithUpdates.filter((m) => m.updateAvailable)
            : modulesWithUpdates;
        const term = search.trim().toLocaleLowerCase();
        if (term === "") return base;
        return base.filter((m) =>
            [moduleName(m, __locale, t), moduleDescription(m, __locale, t), m.id]
                .some((text) => text.toLocaleLowerCase().includes(term)));
    }, [updatesOnly, modulesWithUpdates, search, __locale, t]);


    return {
        modules,
        marketplace,
        loading,
        loadingMarketplace,
        updating,
        installing,
        installProgress,
        uploading,
        deleting,
        updatingModule,
        isBusy,
        marketplaceFilter,
        setMarketplaceFilter,
        selectedModules,
        setSelectedModules,
        bulkInstalling,
        bulkProgress,
        sortKey,
        setSortKey,
        selectedTags,
        setSelectedTags,
        updatesOnly,
        setUpdatesOnly,
        detailModule,
        setDetailModule,
        fileInputRef,
        installedIds,
        marketplaceById,
        updatesAvailableCount,
        toggleModule,
        handleUpload,
        handleDelete,
        handleUpdate,
        handleMarketplaceInstall,
        toggleSelect,
        toggleTag,
        handleBulkInstall,
        filteredMarketplace,
        categories,
        allTags,
        installedToShow,
        search,
        setSearch,
    };
}
