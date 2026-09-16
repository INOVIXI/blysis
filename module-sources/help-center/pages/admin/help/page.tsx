"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, UrlOrFile, Input, Label, RichTextEditor, Textarea, NativeSelect, useFormRoute, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
import { writeError } from "@/core/sdk";
import { helpfulness, type Verdict } from "../../../lib/helpfulness";
import { AdminPageHeader } from "@/core/sdk/admin";

interface HelpCategory {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    isActive: boolean;
    _count?: { articles: number };
}

interface HelpArticle {
    id: string;
    title: string;
    slug: string;
    content: string;
    views: number;
    helpful: number;
    notHelpful: number;
    isActive: boolean;
    category: { id: string; name: string } | null;
}

const VERDICT_TONE: Record<Verdict, string> = {
    helping: "bg-success/10 text-success",
    mixed: "bg-warning/10 text-warning",
    failing: "bg-destructive/10 text-destructive",
    unrated: "bg-muted text-muted-foreground",
};

/**
 * What the votes on one article say, in the order an operator reads it: the
 * share first, because that is the number they came for, then the verdict,
 * then the counts the share was worked out from.
 */
function Helpfulness({ article }: { article: HelpArticle }) {
    const t = useTranslations("helpCenter");
    const read = helpfulness(article.helpful, article.notHelpful);

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="tabular-nums font-medium">
                {read.ratio === null ? "-" : `${Math.round(read.ratio * 100)}%`}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${VERDICT_TONE[read.verdict]}`}>
                {t(`adm_verdict_${read.verdict}`)}
            </span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <ThumbsUp className="w-3 h-3" aria-hidden="true" />
                {article.helpful}
                <ThumbsDown className="w-3 h-3 ml-1" aria-hidden="true" />
                {article.notHelpful}
            </span>
        </div>
    );
}

export default function AdminHelpCenterPage() {
    const t = useTranslations("helpCenter");
    const commonT = useTranslations("common");
    const [categories, setCategories] = useState<HelpCategory[]>([]);
    const [articles, setArticles] = useState<HelpArticle[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"articles" | "categories">("articles");
    /**
     * Which end of the helpfulness list is on top. The default is the order
     * the endpoint sent, because an operator arriving here is usually looking
     * for one article by name rather than reading a league table.
     */
    const [byHelpfulness, setByHelpfulness] = useState<"off" | "worst" | "best">("off");

    // Sorted on a copy: `articles` is what the endpoint sent, and reordering
    // it in place would make "off" unreachable without another request.
    const orderedArticles = byHelpfulness === "off"
        ? articles
        : [...articles].sort((a, b) => {
            const left = helpfulness(a.helpful, a.notHelpful).score;
            const right = helpfulness(b.helpful, b.notHelpful).score;
            return byHelpfulness === "worst" ? left - right : right - left;
        });

    // Both forms are screens of their own rather than cards above the tab
    // they belong to. There are two of them here, so the parameter names
    // which: `?form=article`, `?form=category`.
    const { formParam, formHref, closeForm } = useFormRoute();
    const showArticleForm = formParam === "article";
    const showCategoryForm = formParam === "category";

    // Article form
    const [articleForm, setArticleForm] = useState({ title: "", content: "", categoryId: "", isActive: true });
    const [savingArticle, setSavingArticle] = useState(false);

    // Category form
    const [categoryForm, setCategoryForm] = useState({ name: "", description: "", icon: "", image: "", isActive: true });
    const [savingCategory, setSavingCategory] = useState(false);
    const [iconMode, setIconMode] = useState<"icon" | "image">("icon");

    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const [catRes, artRes] = await Promise.all([
                fetch("/api/v1/help/categories"),
                fetch("/api/v1/help/articles"),
            ]);
            if (catRes.ok) {
                const catData = await catRes.json();
                setCategories(Array.isArray(catData) ? catData : catData.categories || []);
            }
            if (artRes.ok) {
                const artData = await artRes.json();
                setArticles(Array.isArray(artData) ? artData : artData.articles || []);
            }
        } catch (err) {
            console.error("Failed to fetch help center data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const createArticle = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingArticle(true);
        setError(null);
        try {
            const res = await fetch("/api/v1/help/articles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(articleForm),
            });
            const failed = await writeError(res, t("adm_createArticleFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }
            setArticleForm({ title: "", content: "", categoryId: "", isActive: true });
            await fetchData();
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSavingArticle(false);
        }
    };

    const createCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingCategory(true);
        setError(null);
        try {
            const res = await fetch("/api/v1/help/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(categoryForm),
            });
            const failed = await writeError(res, t("adm_createCategoryFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }
            setCategoryForm({ name: "", description: "", icon: "", image: "", isActive: true });
            await fetchData();
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSavingCategory(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (showArticleForm) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_newHelpArticle")}
                    description={t("adm_manageKnowledgeBase")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {error && (
                    <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
                )}

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={createArticle} className="space-y-4">
                            <div>
                                <Label>{`${t("adm_title")} *`}</Label>
                                <Input
                                    aria-label={t("adm_title")}
                                    value={articleForm.title}
                                    onChange={(e) => setArticleForm({ ...articleForm, title: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <Label>{`${t("adm_category")} *`}</Label>
                                {categories.length === 0 ? (
                                    <p className="text-sm text-destructive mt-1">{t("adm_noCategoriesYet")}</p>
                                ) : (
                                    <NativeSelect
                                        aria-label={t("adm_category")}
                                        value={articleForm.categoryId}
                                        onChange={(e) => setArticleForm({ ...articleForm, categoryId: e.target.value })} className="w-full"
                                        required
                                    >
                                        <option value="">{t("adm_selectCategory")}</option>
                                        {categories.map((cat) => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </NativeSelect>
                                )}
                            </div>
                            <div>
                                <Label>{`${t("adm_content")} *`}</Label>
                                <RichTextEditor
                                    value={articleForm.content}
                                    onChange={(value: string) => setArticleForm({ ...articleForm, content: value })}
                                />
                            </div>
                            <Button type="submit" disabled={savingArticle}>
                                {savingArticle ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</> : t("adm_createArticle")}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </>
        );
    }

    if (showCategoryForm) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_newHelpCategory")}
                    description={t("adm_manageKnowledgeBase")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {error && (
                    <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
                )}

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={createCategory} className="space-y-4">
                            <div>
                                <Label>{`${t("adm_name")} *`}</Label>
                                <Input
                                    aria-label={t("adm_name")}
                                    value={categoryForm.name}
                                    onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <Label>{t("adm_description")}</Label>
                                <Textarea
                                    aria-label={t("adm_description")}
                                    value={categoryForm.description}
                                    onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                                    rows={3}
                                />
                            </div>
                            <div>
                                <Label>{t("adm_icon")}</Label>
                                <div className="flex gap-2 mb-2">
                                    <button
                                        type="button"
                                        onClick={() => setIconMode("icon")}
                                        className={`px-3 py-1.5 rounded-md text-xs border ${
                                            iconMode === "icon"
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-muted border-border text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {t("adm_lucideIcon")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIconMode("image")}
                                        className={`px-3 py-1.5 rounded-md text-xs border ${
                                            iconMode === "image"
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "bg-muted border-border text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {t("adm_imageUpload")}
                                    </button>
                                </div>
                                {iconMode === "icon" ? (
                                    <Input
                                        value={categoryForm.icon}
                                        onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value, image: "" })}
                                        placeholder="HelpCircle, BookOpen, Lightbulb..."
                                        aria-label={t("adm_lucideIcon")}
                                    />
                                ) : (
                                    <UrlOrFile
                                        value={categoryForm.image || ""}
                                        onChange={(v) => setCategoryForm({ ...categoryForm, image: v, icon: "" })}
                                        accept="image/*"
                                    />
                                )}
                            </div>
                            <Button type="submit" disabled={savingCategory}>
                                {savingCategory ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</> : t("adm_createCategory")}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_helpCenter")}
                description={t("adm_manageKnowledgeBase")}
                actions={
                    /* The primary action follows the open tab, and it lives
                       where every other admin screen keeps it: the header. It
                       used to sit in a right-aligned row of its own under the
                       tabs, so the same "new X" control was in a different
                       place here than anywhere else in the panel. */
                    activeTab === "articles" ? (
                        <Link href={formHref("article")} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newArticle")}</Link>
                    ) : (
                        <Link href={formHref("category")} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newCategory")}</Link>
                    )
                }
            />

            {error && (
                <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                <Button
                    variant={activeTab === "articles" ? "default" : "outline"}
                    onClick={() => setActiveTab("articles")}
                >
                    {t("adm_tabArticles", { count: articles.length })}
                </Button>
                <Button
                    variant={activeTab === "categories" ? "default" : "outline"}
                    onClick={() => setActiveTab("categories")}
                >
                    {t("adm_tabCategories", { count: categories.length })}
                </Button>
            </div>

            {/* Articles Tab */}
            {activeTab === "articles" && (
                <>
                    <Card>
                        <CardContent className="p-0">
                            {articles.length === 0 ? (
                                <p className="text-muted-foreground text-center py-8">{t("adm_noHelpArticles")}</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b">
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_title")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_category")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_views")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                                                    <button
                                                        type="button"
                                                        className="font-medium hover:text-foreground"
                                                        onClick={() => setByHelpfulness(
                                                            byHelpfulness === "worst" ? "best" : byHelpfulness === "best" ? "off" : "worst",
                                                        )}
                                                    >
                                                        {t("adm_helpfulness")}
                                                        {byHelpfulness === "worst" ? " \u2193" : byHelpfulness === "best" ? " \u2191" : ""}
                                                    </button>
                                                </th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {orderedArticles.map((article) => (
                                                <tr key={article.id} className="hover:bg-muted/50 border-b last:border-0">
                                                    <td className="py-3 px-4">
                                                        <p className="font-medium">{article.title}</p>
                                                        <p className="text-xs text-muted-foreground">/{article.slug}</p>
                                                    </td>
                                                    <td className="py-3 px-4 text-sm text-muted-foreground">
                                                        {article.category?.name || "-"}
                                                    </td>
                                                    <td className="py-3 px-4 text-sm">{article.views}</td>
                                                    <td className="py-3 px-4 text-sm">
                                                        <Helpfulness article={article} />
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className={`text-xs px-2 py-1 rounded ${
                                                            article.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                                                        }`}>
                                                            {article.isActive ? t("adm_active") : t("adm_inactive")}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}

            {/* Categories Tab */}
            {activeTab === "categories" && (
                <>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {categories.length === 0 ? (
                            <Card className="col-span-full">
                                <CardContent className="py-8 text-center">
                                    <p className="text-muted-foreground">{t("adm_noHelpCategories")}</p>
                                </CardContent>
                            </Card>
                        ) : (
                            categories.map((cat) => (
                                <Card key={cat.id}>
                                    <CardHeader>
                                        <CardTitle className="flex items-center justify-between">
                                            <span className="flex items-center gap-2">
                                                {cat.icon && <span>{cat.icon}</span>}
                                                {cat.name}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded ${
                                                cat.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                                            }`}>
                                                {cat.isActive ? t("adm_active") : t("adm_inactive")}
                                            </span>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground mb-2">
                                            {cat.description || t("adm_noDescription")}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {cat._count?.articles || 0} articles
                                        </p>
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>
                </>
            )}
        </>
    );
}
