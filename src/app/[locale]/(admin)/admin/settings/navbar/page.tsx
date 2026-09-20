"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { Loader2, Check, Plus, X, Trash2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { invalidateSettingsCache } from "@/core/hooks/useSiteSettings";
import { useTranslations } from "next-intl";
import { foldNavLinks } from "@/core/lib/navbar-links";
import { ModuleNavLinks } from "@/core/generated/module-registry";
import { useAllModules } from "@/core/providers/module-provider";
import { IconPicker } from "@/core/components/ui/icon-picker";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useSettingsLoad } from "@/core/hooks/useSettingsLoad";

interface NavChild {
    label: string;
    href: string;
}

interface NavLink {
    label: string;
    // Carried through from the module manifest so a seeded list that the admin
    // saves unchanged keeps following the locale. Typing a label clears it:
    // text the admin wrote is what they meant to show.
    labelKey?: string;
    href: string;
    icon?: string;
    children?: NavChild[];
}

export default function NavbarSettingsPage() {
    const t = useTranslations("admin");
    // The bar's own words, so this screen can seed itself with the bar the
    // site is actually drawing rather than with a flat list of every link.
    const navT = useTranslations("nav");
    const commonT = useTranslations("common");
    const moduleStatus = useAllModules();
    const [links, setLinks] = useState<NavLink[]>([]);
    const [saving, setSaving] = useState(false);
    const [expandedDropdown, setExpandedDropdown] = useState<number | null>(null);

    // Without an override this editor seeds itself from the registry, which
    // means a failed read looks exactly like "no override yet" - and saving
    // it replaces the admin's own navbar with the module defaults.
    const { loading, failed, retry } = useSettingsLoad((settings) => {
        const navLinks = settings.navbar_links;
        if (Array.isArray(navLinks)) {
            setLinks(navLinks);
            return;
        }
        /*
         * No override yet - seed with what the navbar is currently drawing,
         * fold and all.
         *
         * It used to seed a flat list of every link. The bar folds anything
         * past eight under "More", so an operator opened this screen, saw a
         * different bar from the one on their own site, and the first save
         * they made - to change one label - replaced the fold with nine
         * links inline. `foldNavLinks` is the bar's own function.
         */
        const registry = ModuleNavLinks
            .filter(nl => isEnabledIn(moduleStatus, nl.module))
            .map(nl => ({ label: nl.label, labelKey: nl.labelKey, href: nl.href, icon: nl.icon || "" }));
        setLinks(foldNavLinks(
            [{ label: "Home", labelKey: "home", href: "/", icon: "Home" }, ...registry],
            navT("more"),
        ));
    }, [moduleStatus]);

    const addLink = () => setLinks([...links, { label: "", href: "/", icon: "" }]);
    // The word the bar uses for a fold, not an English one written into an
    // operator's own navbar.
    const addDropdown = () => setLinks([...links, { label: navT("more"), href: "#", icon: "Star", children: [{ label: "", href: "/" }] }]);

    const updateLink = (i: number, field: string, value: string) => {
        setLinks(links.map((l, idx) => {
            if (idx !== i) return l;
            // An edited label is the admin's own words, so it stops deferring
            // to the module's translation key.
            if (field === "label") return { ...l, label: value, labelKey: undefined };
            return { ...l, [field]: value };
        }));
    };

    const removeLink = (i: number) => {
        setLinks(links.filter((_, idx) => idx !== i));
        if (expandedDropdown === i) setExpandedDropdown(null);
    };

    const moveLink = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= links.length) return;
        const newLinks = [...links];
        [newLinks[i], newLinks[j]] = [newLinks[j], newLinks[i]];
        setLinks(newLinks);
    };

    const addChild = (i: number) => {
        const newLinks = [...links];
        if (!newLinks[i].children) newLinks[i].children = [];
        newLinks[i].children!.push({ label: "", href: "/" });
        setLinks(newLinks);
    };

    const updateChild = (parentIdx: number, childIdx: number, field: string, value: string) => {
        const newLinks = [...links];
        (newLinks[parentIdx].children![childIdx] as unknown as Record<string, string>)[field] = value;
        setLinks(newLinks);
    };

    const removeChild = (parentIdx: number, childIdx: number) => {
        const newLinks = [...links];
        newLinks[parentIdx].children = newLinks[parentIdx].children!.filter((_, idx) => idx !== childIdx);
        if (newLinks[parentIdx].children!.length === 0) delete newLinks[parentIdx].children;
        setLinks(newLinks);
    };

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ navbar_links: links }),
            });
            if (res.ok) {
                invalidateSettingsCache();
                toast.success(t("navbar_saved"));
            } else {
                toast.error(t("navbar_saveFailed"));
            }
        } catch {
            toast.error(t("navbar_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("navbar_title")} description={t("navbar_subtitle")} />
                <Card><CardContent><LoadFailed onRetry={retry} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            {/* The page is one form, so its save is a page action: it sits in
                the header rather than between the last card and the help
                text, which is where the eye looks for neither. */}
            <AdminPageHeader
                title={t("navbar_title")}
                description={t("navbar_subtitle")}
                actions={
                    <Button onClick={save} disabled={saving}>
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("common_saving")}</> : <><Check className="w-4 h-4" /> {t("navbar_save")}</>}
                    </Button>
                }
            />

            <Card className="mb-6">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>{t("navbar_links")}</CardTitle>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={addLink}><Plus className="w-4 h-4" /> {t("navbar_addLink")}</Button>
                            <Button variant="outline" size="sm" onClick={addDropdown}><Plus className="w-4 h-4" /> {t("navbar_addDropdown")}</Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {links.map((link, i) => {
                            const isDropdown = link.children && link.children.length > 0;
                            const isExpanded = expandedDropdown === i;

                            return (
                                <div key={i} className="border border-border rounded-lg overflow-hidden">
                                    {/* Main row */}
                                    <div className="flex items-center gap-2 p-3 bg-muted">
                                        <div className="flex flex-col gap-0.5">
                                            <button aria-label={t("common_moveUp", { label: link.label })} onClick={() => moveLink(i, -1)} className="text-muted-foreground hover:text-foreground text-xs"><span aria-hidden="true">▲</span></button>
                                            <button aria-label={t("common_moveDown", { label: link.label })} onClick={() => moveLink(i, 1)} className="text-muted-foreground hover:text-foreground text-xs"><span aria-hidden="true">▼</span></button>
                                        </div>
                                        <Input value={link.label} onChange={(e) => updateLink(i, "label", e.target.value)} placeholder={t("navbar_labelPlaceholder")} aria-label={t("navbar_labelPlaceholder")} className="flex-1 min-w-0" />
                                        {!isDropdown && (
                                            <Input value={link.href} onChange={(e) => updateLink(i, "href", e.target.value)} placeholder="/path" aria-label={t("navbar_pathLabel")} className="flex-1 min-w-0" />
                                        )}
                                        <IconPicker
                                            value={link.icon || ""}
                                            onChange={(v) => updateLink(i, "icon", v)}
                                            className="w-48 flex-shrink-0"
                                        />
                                        {isDropdown && (
                                            <Button variant="ghost" size="sm" onClick={() => setExpandedDropdown(isExpanded ? null : i)}>
                                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                <span className="text-xs">{link.children!.length}</span>
                                            </Button>
                                        )}
                                        {!isDropdown && (
                                            <Button variant="ghost" size="sm" onClick={() => {
                                                const newLinks = [...links];
                                                newLinks[i].children = [{ label: "", href: "/" }];
                                                newLinks[i].href = "#";
                                                setLinks(newLinks);
                                                setExpandedDropdown(i);
                                            }} title={t("navbar_convertDropdown")}>
                                                <ChevronDown className="w-3 h-3" />
                                            </Button>
                                        )}
                                        <Button aria-label={commonT("remove")} variant="ghost" size="sm" onClick={() => removeLink(i)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                                    </div>

                                    {/* What a visitor reads, where it differs
                                        from what is stored.

                                        A module's link is stored as its own
                                        English name with a translation key
                                        beside it, and the box above holds
                                        what is stored - typing in it is the
                                        operator's own word and drops the key,
                                        so the box cannot simply show the
                                        translation. This screen said "Store"
                                        where the site says "Magaza", and an
                                        operator had no way to know the two
                                        were the same link. */}
                                    {link.labelKey && navT.has(link.labelKey) && navT(link.labelKey) !== link.label && (
                                        <p className="border-t border-border bg-muted px-3 pb-2 text-xs text-muted-foreground">
                                            {t("navbar_visitorsSee", { label: navT(link.labelKey) })}
                                        </p>
                                    )}

                                    {/* Dropdown children */}
                                    {isDropdown && isExpanded && (
                                        <div className="border-t border-border p-3 bg-card space-y-2">
                                            <Label className="text-xs text-muted-foreground">{t("navbar_dropdownItems")}</Label>
                                            {link.children!.map((child, j) => (
                                                <div key={j} className="flex items-center gap-2 pl-6">
                                                    <span className="text-muted-foreground">└</span>
                                                    <Input aria-label={t("navbar_dropdownItems")} value={child.label} onChange={(e) => updateChild(i, j, "label", e.target.value)} placeholder={t("navbar_subItemPlaceholder")} className="flex-1" />
                                                    <Input value={child.href} onChange={(e) => updateChild(i, j, "href", e.target.value)} placeholder="/path" aria-label={t("navbar_pathLabel")} className="flex-1" />
                                                    <Button aria-label={commonT("remove")} variant="ghost" size="sm" onClick={() => removeChild(i, j)}><X className="w-3 h-3 text-destructive" /></Button>
                                                </div>
                                            ))}
                                            <Button variant="ghost" size="sm" className="ml-6" onClick={() => addChild(i)}>
                                                <Plus className="w-3 h-3" /> {t("navbar_addSubItem")}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            <div className="mt-4 p-4 bg-muted rounded-lg text-sm text-muted-foreground space-y-1">
                <p>
                    <strong>{t("navbar_icons")}</strong>{" "}
                    {t("navbar_iconsHint")}{" "}
                    <a href="https://lucide.dev/icons" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        lucide.dev/icons <ExternalLink className="w-3 h-3" />
                    </a>
                    {" "}- {t("navbar_iconsHintClear")}
                </p>
                <p>
                    <strong>{t("navbar_dropdown")}</strong> {t("navbar_dropdownHint")}
                </p>
            </div>
        </>
    );
}
