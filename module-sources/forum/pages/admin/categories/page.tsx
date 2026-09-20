"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, IconPicker, Input, Label, NavIcon, RichTextEditor, useFormRoute, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { writeError } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";

interface Category {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    order: number;
    isActive: boolean;
    _count: { topics: number };
}

export default function AdminForumCategoriesPage() {
    const t = useTranslations("forum");
    const commonT = useTranslations("common");
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    // The form is a screen of its own at `?form=new`, not a card above the list.
    const { showForm, formHref, closeForm } = useFormRoute();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({
        name: "",
        description: "",
        icon: "",
        color: "#6366f1",
        order: 0,
    });

    const fetchCategories = async () => {
        try {
            // The operator's answer: a section switched off, or private to a
            // role this operator is not in, is still theirs to manage.
            const res = await fetch("/api/v1/forum/categories?scope=admin");
            if (res.ok) {
                const data = await res.json();
                setCategories(data.categories || []);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const res = await fetch("/api/v1/forum/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const failed = await writeError(res, t("adm_createCategoryFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }

            setForm({ name: "", description: "", icon: "", color: "#6366f1", order: 0 });
            await fetchCategories();
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const errorBanner = error && (
        <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
    );

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_newCategory")}
                    description={t("adm_manageCategories")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {errorBanner}

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{`${t("adm_name")} *`}</Label>
                                    <Input
                                        aria-label={t("adm_name")}
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div>
                                    {/* The public board draws this through
                                        `NavIcon`, which knows lucide names and
                                        nothing else. A free text box with an
                                        emoji in its placeholder was teaching
                                        operators to pick an icon the board
                                        would never render. */}
                                    <Label htmlFor="forum-category-icon">{t("adm_icon")}</Label>
                                    <IconPicker
                                        id="forum-category-icon"
                                        value={form.icon}
                                        placeholder={t("adm_icon")}
                                        onChange={(icon) => setForm({ ...form, icon })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>{t("adm_description")}</Label>
                                <RichTextEditor
                                    value={form.description}
                                    onChange={(v) => setForm({ ...form, description: v })}
                                />
                            </div>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("adm_color")}</Label>
                                    <div className="flex gap-2">
                                        <input
                                            aria-label={t("adm_color")}
                                            type="color"
                                            value={form.color}
                                            onChange={(e) => setForm({ ...form, color: e.target.value })}
                                            className="w-10 h-10 rounded cursor-pointer"
                                        />
                                        <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} aria-label={t("adm_color")} />
                                    </div>
                                </div>
                                <div>
                                    <Label>{t("adm_sortOrder")}</Label>
                                    <Input
                                        aria-label={t("adm_sortOrder")}
                                        type="number"
                                        value={form.order}
                                        onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</> : t("adm_createCategory")}
                                </Button>
                                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                                    {t("adm_cancel")}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_forumCategories")}
                description={t("adm_manageCategories")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("adm_newCategory")}
                        </Link>
                </>}
            />

            {errorBanner}

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.length === 0 ? (
                    <Card className="col-span-full">
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground">{t("adm_noForumCategories")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    categories.map((cat) => (
                        <Card key={cat.id}>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <NavIcon name={cat.icon} className="w-5 h-5" />
                                    <span style={{ color: cat.color || undefined }}>{cat.name}</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground mb-3">
                                    {cat.description || t("adm_noDescription")}
                                </p>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{t('topicsCount', { count: cat._count.topics })}</span>
                                    <span className={cat.isActive ? "text-success" : "text-muted-foreground"}>
                                        {cat.isActive ? t("adm_active") : t("adm_inactive")}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </>
    );
}
