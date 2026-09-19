"use client";

import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Badge } from "@/core/components/ui/badge";
import { Link } from "@/core/lib/i18n/navigation";
import {
    Package, Upload, Loader2, Trash2, Download, CheckCircle, Cog,
    Search as SearchIcon, ArrowUp, X, Tag as TagIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ListControls } from "@/core/components/ui/list-controls";
import { categoryClassName, resolveDependencyBadge } from "./module-display";
import { moduleDescription, moduleName } from "@/core/lib/module-label";
import type { SortKey } from "./types";
import { useAdminModules } from "./useAdminModules";
import { ModuleIcon } from "./ModuleIcon";
import { ModuleDetailModal } from "./ModuleDetailModal";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Checkbox } from "@/core/components/ui/checkbox";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";

export default function AdminModulesPage() {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const locale = useLocale();
    const {
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
    } = useAdminModules();

    return (
        <>
            {(installProgress || bulkProgress) && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center">
                    <div className="fixed inset-0 bg-black/50" />
                    <div className="relative bg-card border border-border rounded-xl shadow-2xl p-8 w-full max-w-sm mx-4 text-center">
                        <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                        {bulkProgress ? (
                            <>
                                <h2 className="font-semibold text-lg mb-1">{t("modules_installingModules", { current: bulkProgress.current, total: bulkProgress.total })}</h2>
                                <p className="text-sm text-muted-foreground">{bulkProgress.name}</p>
                                <div className="mt-4 w-full bg-muted rounded-full h-2 overflow-hidden">
                                    <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }} />
                                </div>
                            </>
                        ) : installProgress ? (
                            <>
                                <h2 className="font-semibold text-lg mb-1">{installProgress.name}</h2>
                                <p className="text-sm text-muted-foreground">{installProgress.step}</p>
                                <div className="mt-4 w-full bg-muted rounded-full h-2 overflow-hidden">
                                    <div className="bg-primary h-full rounded-full transition-[width] duration-500" style={{ width: installProgress.step === "Done!" ? "100%" : "60%" }} />
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
            )}

            <AdminPageHeader
                title={t("modules_title")}
                description={t("modules_subtitle")}
            />

            {updatesOnly && updatesAvailableCount > 0 && (
                <Card className="mb-6 border-warning/40 bg-warning/10">
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                            <ArrowUp className="w-4 h-4 text-warning" />
                            <span className="font-medium">
                                {t("modules_updatesAvailable", { count: updatesAvailableCount })}
                            </span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setUpdatesOnly(false)}>
                            <X className="w-3 h-3" /> {t("modules_clearFilter")}
                        </Button>
                    </CardContent>
                </Card>
            )}

            <Card className="mb-6">
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h2 className="font-semibold">{t("modules_customModule")}</h2>
                            <p className="text-sm text-muted-foreground">{t("modules_uploadDesc")}</p>
                        </div>
                        <div>
                            <input type="file" accept=".zip" ref={fileInputRef} aria-label={t("modules_uploadZip")} className="hidden" onChange={handleUpload} />
                            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("modules_installing")}</> : <><Upload className="w-4 h-4" /> {t("modules_uploadZip")}</>}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Installed Modules */}
            <div className="mb-10">
                <h2 className="text-xl font-bold mb-4">
                    {t("modules_installedModules")} ({installedToShow.length})
                </h2>

                {/* Eighty-nine cards is a wall, not a list. The term is
                    matched against the name and description a card actually
                    shows, in the reader's language. */}
                <ListControls
                    className="mb-4"
                    search={{ value: search, onChange: setSearch, placeholder: t("modules_search") }}
                />

                {loading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : installedToShow.length === 0 && search.trim() !== "" ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            {commonT("noResults")}
                        </CardContent>
                    </Card>
                ) : installedToShow.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                            <p className="text-muted-foreground mb-1">
                                {updatesOnly ? "No updates available" : t("modules_noModules")}
                            </p>
                            <p className="text-sm text-muted-foreground">{t("modules_browseMarketplace")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {installedToShow.map((mod) => {
                            const mp = marketplaceById.get(mod.id);
                            return (
                                /* A grid row is as tall as its tallest card,
                                   so one with a three line description and a
                                   dependency badge stretched the two beside
                                   it and left their buttons floating in the
                                   middle of the space. The card fills its
                                   row and its actions sit at the foot. */
                                <Card key={mod.id} className={`h-full transition-all ${!mod.enabled ? "opacity-60" : ""}`}>
                                    <CardContent className="flex h-full flex-col p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-2.5">
                                                <span className="text-primary"><ModuleIcon name={mod.icon} /></span>
                                                <div>
                                                    <h3 className="font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                                                        {moduleName(mod, locale, t)}
                                                        <Badge className="font-mono">v{mod.version}</Badge>
                                                        {mod.updateAvailable && mod.latestVersion && (
                                                            <Badge tone="warning">
                                                                <ArrowUp className="w-2.5 h-2.5" />
                                                                {t("modules_updateToLatest", { version: mod.latestVersion })}
                                                            </Badge>
                                                        )}
                                                    </h3>
                                                </div>
                                            </div>
                                            <Badge tone={mod.enabled ? "success" : "neutral"}>
                                                {mod.enabled ? t("modules_on") : t("modules_off")}
                                            </Badge>
                                        </div>

                                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{moduleDescription(mod, locale, t)}</p>

                                        {((mod.dependencies && mod.dependencies.length > 0) || (mod.conflicts && mod.conflicts.length > 0)) && (
                                            <div className="mb-3 space-y-1">
                                                {mod.dependencies && mod.dependencies.length > 0 && (
                                                    <div className="flex items-center gap-1.5 text-xs">
                                                        <span className="text-warning font-medium">{t("modules_requires")}</span>
                                                        <div className="flex gap-1 flex-wrap">
                                                            {mod.dependencies.map(dep => {
                                                                const badge = resolveDependencyBadge(dep, modules, marketplace);
                                                                return (
                                                                    <Badge key={badge.spec} tone={badge.satisfied ? "success" : "danger"}>
                                                                        {badge.label} {badge.satisfied ? "" : badge.versionMismatch ? t("modules_versionMismatch") : t("modules_missing")}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                                {mod.conflicts && mod.conflicts.length > 0 && (
                                                    <div className="flex items-center gap-1.5 text-xs">
                                                        <span className="text-destructive font-medium">{t("modules_incompatible")}</span>
                                                        <div className="flex gap-1 flex-wrap">
                                                            {mod.conflicts.map(cId => {
                                                                const cMod = modules.find(m => m.id === cId);
                                                                return (
                                                                    <Badge key={cId} tone="danger">
                                                                        {cMod?.name || cId}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Pushed to the foot, so the row of
                                            cards ends on one line however
                                            long each description is. */}
                                        <div className="mt-auto flex gap-2 pt-2">
                                            <Button
                                                variant={mod.enabled ? "outline" : "default"}
                                                size="sm"
                                                className="flex-1 text-xs"
                                                disabled={updating === mod.id}
                                                onClick={() => toggleModule(mod.id, !mod.enabled)}
                                            >
                                                {updating === mod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : mod.enabled ? t("modules_disable") : t("modules_enable")}
                                            </Button>
                                            {(mod.settings ?? []).length > 0 && (
                                                <Link
                                                    href={`/admin/modules/${mod.id}`}
                                                    aria-label={t("modules_settings")}
                                                    title={t("modules_settings")}
                                                    className={buttonClassName("ghost", "sm")}
                                                >
                                                    <Cog className="w-3 h-3" />
                                                </Link>
                                            )}
                                            {mp && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    title={t("modules_viewDetails")}
                                                    onClick={() => setDetailModule(mp)}
                                                >
                                                    <SearchIcon className="w-3 h-3" />
                                                </Button>
                                            )}
                                            {mod.updateAvailable && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={updatingModule === mod.id}
                                                    onClick={() => handleUpdate(mod)}
                                                    className="text-warning hover:text-warning border-warning/30"
                                                    title={t("modules_updateToVersion", { version: mod.latestVersion ?? "" })}
                                                >
                                                    {updatingModule === mod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUp className="w-3 h-3" />}
                                                </Button>
                                            )}
                                            <Button
                                                aria-label={commonT("delete")}
                                                variant="ghost"
                                                size="sm"
                                                disabled={deleting === mod.id}
                                                onClick={() => handleDelete(mod.id, moduleName(mod, locale, t))}
                                                className="text-destructive hover:text-destructive"
                                            >
                                                {deleting === mod.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Marketplace */}
            <div>
                <div className="flex flex-col gap-4 mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-primary" />
                                {t("modules_verifiedModules")}
                            </h2>
                            <p className="text-sm text-muted-foreground">{t("modules_officialModules")}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            {selectedModules.size > 0 && (
                                <Button size="sm" onClick={handleBulkInstall} disabled={isBusy || bulkInstalling}>
                                    {bulkInstalling ? <><Loader2 className="w-3 h-3 animate-spin .5" /> {t("modules_installing")}</> : <><Download className="w-3 h-3 .5" /> {t("modules_installSelected", { count: selectedModules.size })}</>}
                                </Button>
                            )}
                            {filteredMarketplace.length > 0 && (
                                <Button size="sm" variant="outline" onClick={() => {
                                    if (selectedModules.size === filteredMarketplace.length) setSelectedModules(new Set());
                                    else setSelectedModules(new Set(filteredMarketplace.map(m => m.id)));
                                }}>
                                    {selectedModules.size === filteredMarketplace.length ? t("modules_deselectAll") : t("modules_selectAll")}
                                </Button>
                            )}
                            <label className="text-xs text-muted-foreground">{t("modules_sort")}</label>
                            <NativeSelect
                                aria-label={t("modules_sort")}
                                value={sortKey}
                                onChange={(e) => setSortKey(e.target.value as SortKey)} inputSize="sm"
                            >
                                <option value="newest">{t("modules_newest")}</option>
                                <option value="alphabetical">{t("modules_alphabetical")}</option>
                            </NativeSelect>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant={marketplaceFilter === "all" ? "default" : "outline"} onClick={() => setMarketplaceFilter("all")}>{t("modules_all")}</Button>
                        {categories.map((cat) => (
                            <Button
                                key={cat}
                                size="sm"
                                variant={marketplaceFilter === cat ? "default" : "outline"}
                                onClick={() => setMarketplaceFilter(cat)}
                                className="capitalize"
                            >
                                {cat}
                            </Button>
                        ))}
                    </div>

                    {allTags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <TagIcon className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground mr-1">{t("modules_tags")}</span>
                            {allTags.map((tag) => {
                                const active = selectedTags.has(tag);
                                return (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => toggleTag(tag)}
                                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                                            active
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                                        }`}
                                    >
                                        {tag}
                                    </button>
                                );
                            })}
                            {selectedTags.size > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setSelectedTags(new Set())}
                                    className="text-[10px] text-muted-foreground underline ml-1"
                                >
                                    {t("modules_clearTags")}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {loadingMarketplace ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : filteredMarketplace.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                            {marketplace.length === 0 ? t("modules_couldNotLoad") : t("modules_allInstalled")}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredMarketplace.map((mod) => (
                            <Card key={mod.id} className={`hover:shadow-md transition-shadow flex flex-col ${selectedModules.has(mod.id) ? "ring-2 ring-primary" : ""}`}>
                                <CardContent className="p-4 flex flex-col flex-1">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2.5">
                                            <Checkbox
                                                checked={selectedModules.has(mod.id)}
                                                onChange={() => toggleSelect(mod.id)}
                                                aria-label={t("common_selectRow")}
                                            />
                                            <span className="text-primary"><ModuleIcon name={mod.icon} /></span>
                                            <div>
                                                <button
                                                    type="button"
                                                    onClick={() => setDetailModule(mod)}
                                                    className="font-semibold text-sm flex items-center gap-1.5 hover:underline text-left"
                                                >
                                                    {moduleName(mod, locale, t)}
                                                    {mod.verified && <CheckCircle className="w-3.5 h-3.5 text-primary" />}
                                                </button>
                                                <p className="text-xs text-muted-foreground">
                                                    <span className="font-mono">v{mod.version}</span>
                                                    {" "}{t("modules_byAuthor", { author: mod.author })}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`text-xs px-2 py-0.5 rounded font-medium capitalize ${categoryClassName(mod.category)}`}>
                                            {mod.category}
                                        </span>
                                    </div>

                                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{moduleDescription(mod, locale, t)}</p>

                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                                        {mod.stats.publicRoutes > 0 && <span>{t("modules_pages", { count: mod.stats.publicRoutes })}</span>}
                                        {mod.stats.adminRoutes > 0 && <span>{t("modules_admin", { count: mod.stats.adminRoutes })}</span>}
                                        {mod.stats.apiRoutes > 0 && <span>{t("modules_apis", { count: mod.stats.apiRoutes })}</span>}
                                        {mod.stats.widgets > 0 && <span>{t("modules_widgets", { count: mod.stats.widgets })}</span>}
                                    </div>

                                    {mod.dependencies.length > 0 && (
                                        <div className="flex items-center gap-1.5 text-xs mb-3">
                                            <span className="text-warning font-medium">{t("modules_requires")}</span>
                                            <div className="flex gap-1 flex-wrap">
                                                {mod.dependencies.map((dep: string) => {
                                                    const badge = resolveDependencyBadge(dep, modules, marketplace);
                                                    return (
                                                        <Badge key={badge.spec} tone={badge.satisfied ? "success" : "warning"}>
                                                            {badge.label}
                                                        </Badge>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <Button
                                        size="sm"
                                        className="w-full mt-auto"
                                        disabled={isBusy}
                                        onClick={() => handleMarketplaceInstall(mod)}
                                    >
                                        {installing === mod.id ? (
                                            <><Loader2 className="w-3 h-3 animate-spin .5" /> {t("modules_installing")}</>
                                        ) : (
                                            <><Download className="w-3 h-3 .5" /> {t("modules_install")}</>
                                        )}
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {detailModule && (
                <ModuleDetailModal
                    module={detailModule}
                    onClose={() => setDetailModule(null)}
                />
            )}
        </>
    );
}
