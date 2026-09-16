"use client";

/**
 * Per-page SEO: the site down the left, one page's head on the right.
 *
 * What was here before was a table of rows an operator had created by hand,
 * which meant it started empty on every install and stayed empty on most of
 * them. Nothing on the screen said which pages existed, what each one already
 * told a search engine, or that a page had never been described at all. Core
 * now answers the first two questions - see `listCataloguePages` - so this
 * screen lists the site rather than its own table.
 *
 * The selected page lives in `?page=`, so a row can be linked, reloaded and
 * closed with the back button.
 */

import { useTranslations, useLocale } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, CardContent, Input, Label, Waiting, useConfirm } from "@/core/sdk/ui";
import { usePathname, useRouter } from "@/core/sdk/navigation";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { SeoPageList } from "./SeoPageList";
import { SeoPageForm } from "./SeoPageForm";
import {
    EMPTY_OVERRIDE,
    formFrom,
    saysNothing,
    type CataloguePage,
    type OverrideForm,
    type SeoOverride,
} from "../../../lib/catalogue";

const NEW_PAGE = "new";

export default function SeoPagesScreen() {
    const t = useTranslations("seo");
    const commonT = useTranslations("common");
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { confirm } = useConfirm();

    const [catalogue, setCatalogue] = useState<CataloguePage[]>([]);
    const [overrides, setOverrides] = useState<SeoOverride[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState("");
    const [newPath, setNewPath] = useState("");
    const [form, setForm] = useState<OverrideForm>(EMPTY_OVERRIDE);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/v1/seo/catalogue?locale=${encodeURIComponent(locale)}`);
            if (!res.ok) throw new Error("load");
            const data = await res.json();
            setCatalogue(data.pages ?? []);
            setOverrides(data.overrides ?? []);
        } catch {
            toast.error(t("adm_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [locale, t]);

    useEffect(() => {
        load();
    }, [load]);

    // A path somebody set an override on that no route serves any more - a
    // module since removed, a page that moved. It stays visible so it can be
    // found and cleared rather than going on answering for a URL nobody can
    // see on this screen.
    const pages = useMemo<CataloguePage[]>(() => {
        const known = new Set(catalogue.map((p) => p.path));
        const orphans = overrides
            .filter((o) => !known.has(o.path))
            .map<CataloguePage>((o) => ({
                path: o.path,
                title: o.metaTitle || o.path,
                description: "",
                owner: "custom",
                indexable: !o.noIndex,
                pattern: o.path.includes("["),
            }));
        return [...catalogue, ...orphans];
    }, [catalogue, overrides]);

    const param = searchParams?.get("page") ?? null;
    const selectedPath = param ?? pages[0]?.path ?? "";
    const addingPath = param === NEW_PAGE;

    const selected = useMemo<CataloguePage | null>(() => {
        if (addingPath) {
            return { path: newPath, title: newPath || t("adm_addPath"), description: "", owner: "custom", indexable: true, pattern: newPath.includes("[") };
        }
        return pages.find((p) => p.path === selectedPath) ?? null;
    }, [addingPath, newPath, pages, selectedPath, t]);

    const override = overrides.find((o) => o.path === selected?.path);

    // The form follows the selection rather than the typing, so switching page
    // never carries half an edit across to another page's head.
    useEffect(() => {
        setForm(formFrom(overrides.find((o) => o.path === (param === NEW_PAGE ? "" : (param ?? pages[0]?.path)))));
    }, [param, overrides, pages]);

    const select = (path: string) => router.push(`${pathname}?page=${encodeURIComponent(path)}`);

    const updateField = <K extends keyof OverrideForm>(key: K, value: OverrideForm[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const removeOverride = async (row: SeoOverride) => {
        const res = await fetch(`/api/v1/seo/pages/${row.id}`, { method: "DELETE" });
        if (!res.ok) {
            toast.error(t("adm_saveFailed"));
            return false;
        }
        return true;
    };

    const handleSubmit = async () => {
        if (!selected) return;
        if (!selected.path.startsWith("/")) {
            toast.error(t("adm_pathInvalid"));
            return;
        }

        setSaving(true);
        try {
            // An empty form means "say what the page says", which is no row at
            // all rather than a row of nulls.
            if (saysNothing(form)) {
                if (override && !(await removeOverride(override))) return;
                toast.success(t("adm_settingsSaved"));
            } else {
                const body = {
                    path: selected.path,
                    metaTitle: form.metaTitle || null,
                    metaDescription: form.metaDescription || null,
                    ogTitle: form.ogTitle || null,
                    ogDescription: form.ogDescription || null,
                    ogImage: form.ogImage || null,
                    keywords: form.keywords || null,
                    canonical: form.canonical || null,
                    noIndex: form.noIndex,
                    noFollow: form.noFollow,
                };
                const res = await fetch(override ? `/api/v1/seo/pages/${override.id}` : "/api/v1/seo/pages", {
                    method: override ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (!res.ok) {
                    toast.error(errorMessage(await res.json(), t("adm_saveFailed"), t));
                    return;
                }
                toast.success(t("adm_settingsSaved"));
            }

            await load();
            if (addingPath) {
                setNewPath("");
                select(selected.path);
            }
        } catch {
            toast.error(t("adm_genericError"));
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!override) return;
        const ok = await confirm({
            title: t("adm_resetToDefault"),
            message: t("adm_resetConfirm", { path: override.path }),
            variant: "danger",
            confirmText: t("adm_resetToDefault"),
        });
        if (!ok) return;
        setSaving(true);
        try {
            if (await removeOverride(override)) {
                toast.success(t("adm_resetDone"));
                setForm(EMPTY_OVERRIDE);
                await load();
            }
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Waiting label={commonT("loading")} />;

    return (
        <>
            <AdminPageHeader
                title={t("adm_pageSeoOverrides")}
                description={t("adm_pagesSubtitle")}
                backHref="/admin/seo"
                backLabel={commonT("back")}
                actions={
                    <Button type="button" variant="outline" onClick={() => select(NEW_PAGE)}>
                        <Plus className="w-4 h-4" aria-hidden="true" /> {t("adm_addPath")}
                    </Button>
                }
            />

            <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] items-start">
                <Card>
                    <CardContent className="p-0">
                        <SeoPageList
                            pages={pages}
                            overrides={overrides}
                            selected={addingPath ? "" : selectedPath}
                            query={query}
                            onQueryChange={setQuery}
                            onSelect={select}
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6 space-y-5">
                        {addingPath && (
                            <div>
                                <Label className="text-foreground">{`${t("adm_urlPath")} *`}</Label>
                                <Input
                                    aria-label={t("adm_urlPath")}
                                    value={newPath}
                                    onChange={(e) => setNewPath(e.target.value)}
                                    placeholder="/about"
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("adm_urlPathHelp")}</p>
                            </div>
                        )}

                        {selected ? (
                            <SeoPageForm
                                page={selected}
                                form={form}
                                hasOverride={Boolean(override)}
                                saving={saving}
                                onChange={updateField}
                                onSubmit={handleSubmit}
                                onReset={handleReset}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">{t("adm_noMatches")}</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
