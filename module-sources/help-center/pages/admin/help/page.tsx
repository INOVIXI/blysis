"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge, Button, Card, CardContent, Checkbox, ListControls, LoadFailed, NavIcon, Pagination,
    useConfirm, useFormRoute, useRowPicks, buttonClassName, type BadgeTone,
} from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { Pencil, Plus, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { deleteEach } from "@/core/sdk";
import { helpfulness, type Verdict } from "../../../lib/helpfulness";
import { AdminPageHeader, BulkBar, RowActions } from "@/core/sdk/admin";
import { ArticleForm } from "./ArticleForm";
import { CategoryForm } from "./CategoryForm";
import {
    formTargetParam, readFormTarget,
    type AdminHelpArticle, type AdminHelpCategory,
} from "./rows";

const VERDICT_TONE: Record<Verdict, BadgeTone> = {
    helping: "success",
    mixed: "warning",
    failing: "danger",
    unrated: "neutral",
};

const PER_PAGE = 25;

/**
 * What the votes on one article say, in the order an operator reads it: the
 * share first, because that is the number they came for, then the verdict,
 * then the counts the share was worked out from.
 */
function Helpfulness({ article }: { article: AdminHelpArticle }) {
    const t = useTranslations("helpCenter");
    const read = helpfulness(article.helpful, article.notHelpful);

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="tabular-nums font-medium">
                {read.ratio === null ? "-" : `${Math.round(read.ratio * 100)}%`}
            </span>
            <Badge tone={VERDICT_TONE[read.verdict]}>
                {t(`adm_verdict_${read.verdict}`)}
            </Badge>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <ThumbsUp className="w-3 h-3" aria-hidden="true" />
                {article.helpful}
                <ThumbsDown className="w-3 h-3 ml-1" aria-hidden="true" />
                {article.notHelpful}
            </span>
        </div>
    );
}

function StatusBadge({ active }: { active: boolean }) {
    const t = useTranslations("helpCenter");
    return <Badge tone={active ? "success" : "neutral"}>{active ? t("adm_active") : t("adm_inactive")}</Badge>;
}

/**
 * The help centre, as the operator who writes it sees it.
 *
 * It could create an article and a category and then nothing at all. Fourteen
 * rows sat in a table with no control on any of them: no edit, no delete, no
 * way to tick two, and a typo in a title was permanent. Every endpoint it
 * needed had been written and none of them was called.
 *
 * It also read the visitor's list. `/help/articles` answers a visitor with
 * the active twenty, most-read first, and blanks the view count when the
 * operator has hidden it from the public page - so an article somebody
 * deactivated left the only screen that could bring it back, a help centre
 * with more than twenty articles showed twenty and said nothing, and the
 * Views column went empty for a setting about somewhere else. Both lists ask
 * for `scope=admin` now, which is the operator's answer: everything, paged by
 * the database.
 */
export default function AdminHelpCenterPage() {
    const t = useTranslations("helpCenter");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();

    const [categories, setCategories] = useState<AdminHelpCategory[]>([]);
    const [articles, setArticles] = useState<AdminHelpArticle[]>([]);
    const [articleTotal, setArticleTotal] = useState(0);
    const [articlePages, setArticlePages] = useState(1);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [activeTab, setActiveTab] = useState<"articles" | "categories">("articles");
    /**
     * Which end of the helpfulness list is on top, asked of the database.
     * It used to sort the rows already in the browser, which answers over one
     * page of them: "worst first" on a help centre of sixty articles found
     * the worst of the twenty-five on screen.
     */
    const [byHelpfulness, setByHelpfulness] = useState<"off" | "worst" | "best">("off");

    const articlePicks = useRowPicks(articles);
    const categoryPicks = useRowPicks(categories);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                scope: "admin",
                page: String(page),
                perPage: String(PER_PAGE),
            });
            if (search) params.set("search", search);
            if (byHelpfulness !== "off") params.set("sort", byHelpfulness);

            const [catRes, artRes] = await Promise.all([
                fetch("/api/v1/help/categories?scope=admin"),
                fetch(`/api/v1/help/articles?${params}`),
            ]);
            if (!catRes.ok || !artRes.ok) throw new Error("read failed");

            const catData = await catRes.json();
            const artData = await artRes.json();
            setCategories(catData.categories ?? []);
            setArticles(artData.articles ?? []);
            setArticleTotal(artData.pagination?.total ?? 0);
            setArticlePages(artData.pagination?.pages ?? 1);
            setFailed(false);
        } catch {
            // A read that failed and a help centre with nothing in it look the
            // same on screen, and only one of them is worth retrying.
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [page, search, byHelpfulness]);

    useEffect(() => { void load(); }, [load, reloadKey]);

    const { formParam, formHref, openForm, closeForm } = useFormRoute();
    const target = readFormTarget(formParam);

    const afterWrite = () => {
        articlePicks.clear();
        categoryPicks.clear();
        setReloadKey((k) => k + 1);
    };

    const removeArticle = async (article: AdminHelpArticle) => {
        const ok = await confirm({
            title: t("adm_deleteArticleTitle"),
            message: t("adm_deleteArticleConfirm", { title: article.title }),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/help/articles/${article.slug}`, { method: "DELETE" });
        if (!res.ok) {
            toast.error(t("adm_deleteFailed"));
            return;
        }
        toast.success(t("adm_articleDeleted"));
        afterWrite();
    };

    const removeArticles = async () => {
        const ids = [...articlePicks.picked];
        const ok = await confirm({
            title: t("adm_deleteArticleTitle"),
            message: t("adm_deleteManyArticlesConfirm", { count: ids.length }),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const bySlug = new Map(articles.map((row) => [row.id, row.slug]));
        const { deleted, total } = await deleteEach(ids, async (id) => {
            const res = await fetch(`/api/v1/help/articles/${bySlug.get(id)}`, { method: "DELETE" });
            return res.ok;
        });
        if (deleted === total) toast.success(t("adm_articleDeleted"));
        else if (deleted === 0) toast.error(t("adm_deleteFailed"));
        else toast.error(t("adm_deletedPartly", { deleted, total }));
        afterWrite();
    };

    /**
     * The endpoint refuses a category that still holds articles, and says so
     * in a sentence of its own in English. What a reader sees is said here,
     * in their language, from the code it sends alongside.
     */
    const categoryRefusal = async (res: Response) => {
        const said = await res.json().catch(() => null) as { code?: string } | null;
        return said?.code === "category_has_articles"
            ? t("adm_categoryHasArticles")
            : t("adm_deleteFailed");
    };

    const removeCategory = async (category: AdminHelpCategory) => {
        const ok = await confirm({
            title: t("adm_deleteCategoryTitle"),
            message: t("adm_deleteCategoryConfirm", { name: category.name }),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/help/categories/${category.id}`, { method: "DELETE" });
        if (!res.ok) {
            toast.error(await categoryRefusal(res));
            return;
        }
        toast.success(t("adm_categoryDeleted"));
        afterWrite();
    };

    const removeCategories = async () => {
        const ids = [...categoryPicks.picked];
        const ok = await confirm({
            title: t("adm_deleteCategoryTitle"),
            message: t("adm_deleteManyCategoriesConfirm", { count: ids.length }),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach(ids, async (id) => {
            const res = await fetch(`/api/v1/help/categories/${id}`, { method: "DELETE" });
            return res.ok;
        });
        if (deleted === total) toast.success(t("adm_categoryDeleted"));
        else if (deleted === 0) toast.error(t("adm_categoryHasArticles"));
        else toast.error(t("adm_deletedPartly", { deleted, total }));
        afterWrite();
    };

    /*
     * A form filled from a row waits for that row.
     *
     * The form reads the row once, when it mounts, so rendering it before the
     * list had arrived gave an empty form that never filled: opening the edit
     * address directly - a reload, a link somebody kept - showed blank fields
     * and would have saved them over the article. It waits, and the `key`
     * makes the arrival a fresh form rather than a stale one.
     */
    if (target) {
        const article = target.kind === "article" && target.key
            ? articles.find((row) => row.slug === target.key) ?? null
            : null;
        const category = target.kind === "category" && target.key
            ? categories.find((row) => row.id === target.key) ?? null
            : null;
        const row = article ?? category;

        if (target.key && !row) {
            return loading
                ? <p className="py-12 text-center text-sm text-muted-foreground">{commonT("loading")}</p>
                : <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />;
        }

        return target.kind === "article" ? (
            <ArticleForm
                key={article?.slug ?? "new"}
                article={article}
                categories={categories}
                onBack={closeForm}
                onSaved={() => { afterWrite(); closeForm(); }}
            />
        ) : (
            <CategoryForm
                key={category?.id ?? "new"}
                category={category}
                onBack={closeForm}
                onSaved={() => { afterWrite(); closeForm(); }}
            />
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_helpCenter")}
                description={t("adm_manageKnowledgeBase")}
                actions={
                    /* The primary action follows the open tab, and it lives
                       where every other admin screen keeps it: the header. */
                    activeTab === "articles" ? (
                        <Link href={formHref(formTargetParam("article"))} className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("adm_newArticle")}
                        </Link>
                    ) : (
                        <Link href={formHref(formTargetParam("category"))} className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("adm_newCategory")}
                        </Link>
                    )
                }
            />

            <div className="flex gap-2 mb-6">
                <Button
                    variant={activeTab === "articles" ? "default" : "outline"}
                    onClick={() => setActiveTab("articles")}
                >
                    {t("adm_tabArticles", { count: articleTotal })}
                </Button>
                <Button
                    variant={activeTab === "categories" ? "default" : "outline"}
                    onClick={() => setActiveTab("categories")}
                >
                    {t("adm_tabCategories", { count: categories.length })}
                </Button>
            </div>

            {failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : activeTab === "articles" ? (
                <>
                    <ListControls
                        className="mb-4"
                        search={{ value: search, onChange: (term) => { setPage(1); setSearch(term); } }}
                    />

                    {articlePicks.picked.size > 0 || articles.length > 0 ? (
                        <BulkBar
                            className="mb-4 rounded-lg border border-border"
                            state={articlePicks.headerState}
                            count={articlePicks.picked.size}
                            onToggleAll={articlePicks.toggleAll}
                            actions={
                                <Button variant="destructive" size="sm" onClick={removeArticles}>
                                    <Trash2 className="w-4 h-4" /> {commonT("delete")} {articlePicks.picked.size}
                                </Button>
                            }
                        />
                    ) : null}

                    <Card>
                        <CardContent className="p-0">
                            {loading && articles.length === 0 ? (
                                <p className="text-muted-foreground text-center py-8">{commonT("loading")}</p>
                            ) : articles.length === 0 ? (
                                <p className="text-muted-foreground text-center py-8">
                                    {search ? commonT("noResults") : t("adm_noHelpArticles")}
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b">
                                                <th className="w-10 py-3 px-4" />
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_title")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_category")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_views")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                                                    <button
                                                        type="button"
                                                        className="font-medium hover:text-foreground"
                                                        onClick={() => {
                                                            setPage(1);
                                                            setByHelpfulness(
                                                                byHelpfulness === "worst" ? "best" : byHelpfulness === "best" ? "off" : "worst",
                                                            );
                                                        }}
                                                    >
                                                        {t("adm_helpfulness")}
                                                        {byHelpfulness === "worst" ? " ↓" : byHelpfulness === "best" ? " ↑" : ""}
                                                    </button>
                                                </th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                                <th className="w-24 py-3 px-4" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {articles.map((article) => (
                                                <tr key={article.id} className="hover:bg-muted/50 border-b last:border-0">
                                                    <td className="py-3 px-4">
                                                        <Checkbox
                                                            checked={articlePicks.picked.has(article.id)}
                                                            onChange={() => articlePicks.toggle(article.id)}
                                                            aria-label={t("adm_selectRow")}
                                                        />
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <p className="font-medium">{article.title}</p>
                                                        <p className="text-xs text-muted-foreground">/{article.slug}</p>
                                                    </td>
                                                    <td className="py-3 px-4 text-sm text-muted-foreground">
                                                        {article.category?.name || "-"}
                                                    </td>
                                                    <td className="py-3 px-4 text-sm">{article.views ?? 0}</td>
                                                    <td className="py-3 px-4 text-sm">
                                                        <Helpfulness article={article} />
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <StatusBadge active={article.isActive} />
                                                    </td>
                                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                                        <RowActions
                                                            actions={[
                                                                {
                                                                    icon: Pencil,
                                                                    label: commonT("edit"),
                                                                    onClick: () => openForm(formTargetParam("article", article.slug)),
                                                                },
                                                                {
                                                                    icon: Trash2,
                                                                    label: commonT("delete"),
                                                                    onClick: () => removeArticle(article),
                                                                    destructive: true,
                                                                },
                                                            ]}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <Pagination
                                        page={page}
                                        pages={articlePages}
                                        total={articleTotal}
                                        onPageChange={setPage}
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            ) : (
                <>
                    {categories.length > 0 ? (
                        <BulkBar
                            className="mb-4 rounded-lg border border-border"
                            state={categoryPicks.headerState}
                            count={categoryPicks.picked.size}
                            onToggleAll={categoryPicks.toggleAll}
                            actions={
                                <Button variant="destructive" size="sm" onClick={removeCategories}>
                                    <Trash2 className="w-4 h-4" /> {commonT("delete")} {categoryPicks.picked.size}
                                </Button>
                            }
                        />
                    ) : null}

                    <Card>
                        <CardContent className="p-0">
                            {categories.length === 0 ? (
                                <p className="text-muted-foreground text-center py-8">{t("adm_noHelpCategories")}</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b">
                                                <th className="w-10 py-3 px-4" />
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_name")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_description")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_articleCount")}</th>
                                                <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                                <th className="w-24 py-3 px-4" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {categories.map((category) => (
                                                <tr key={category.id} className="hover:bg-muted/50 border-b last:border-0">
                                                    <td className="py-3 px-4">
                                                        <Checkbox
                                                            checked={categoryPicks.picked.has(category.id)}
                                                            onChange={() => categoryPicks.toggle(category.id)}
                                                            aria-label={t("adm_selectRow")}
                                                        />
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        {/* The mark is stored as a lucide name and was
                                                            printed as one: four rows read "Rocket Getting
                                                            started" and "ShoppingBag Purchases", a column
                                                            of identifiers where names go. */}
                                                        <p className="font-medium flex items-center gap-2">
                                                            <NavIcon name={category.icon} className="w-4 h-4 text-muted-foreground" />
                                                            {category.name}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">/{category.slug}</p>
                                                    </td>
                                                    <td className="py-3 px-4 text-sm text-muted-foreground max-w-[20rem] truncate">
                                                        {category.description || t("adm_noDescription")}
                                                    </td>
                                                    <td className="py-3 px-4 text-sm">
                                                        {t("articles", { count: category._count?.articles ?? 0 })}
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <StatusBadge active={category.isActive} />
                                                    </td>
                                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                                        <RowActions
                                                            actions={[
                                                                {
                                                                    icon: Pencil,
                                                                    label: commonT("edit"),
                                                                    onClick: () => openForm(formTargetParam("category", category.id)),
                                                                },
                                                                {
                                                                    icon: Trash2,
                                                                    label: commonT("delete"),
                                                                    onClick: () => removeCategory(category),
                                                                    destructive: true,
                                                                },
                                                            ]}
                                                        />
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
        </>
    );
}
