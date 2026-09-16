import { Link } from "@/core/sdk/navigation";
import { redirect } from "@/core/sdk/navigation";
import { formatDate } from "@/core/sdk";
import { hasPermission, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { Card, CardContent, CardHeader, CardTitle, Pagination, buttonClassName } from "@/core/sdk/ui";
import { getTranslations, getLocale } from "next-intl/server";
import { dateLocaleTag } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";


export const dynamic = "force-dynamic";

/**
 * One page of articles.
 *
 * The screen used to list every article the site has ever had, with the author
 * and category joined onto each. The totals above the table come from a
 * groupBy, so they never needed the rows.
 */
const PER_PAGE = 25;

async function getBlogArticles(page: number) {
    const [articles, stats] = await Promise.all([
        prisma.blogArticle.findMany({
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * PER_PAGE,
            take: PER_PAGE,
            include: {
                author: { select: { username: true } },
                category: { select: { name: true } },
            },
        }),
        prisma.blogArticle.groupBy({
            by: ["status"],
            _count: true,
        }),
    ]);

    return { articles, stats };
}

interface AdminBlogArticlesPageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminBlogArticlesPage({ searchParams }: AdminBlogArticlesPageProps) {
    const t = await getTranslations("blog");

    // ArticleStatus is a Prisma enum, so the column holds "PUBLISHED". The
    // four adm_* messages for it were already in the manifest, in both
    // locales, and this table printed the enum instead.
    const statusLabel = (status: string) => {
        const key = ({ DRAFT: "adm_draft", PUBLISHED: "adm_published", SCHEDULED: "adm_scheduled", ARCHIVED: "adm_archived" } as Record<string, string>)[status];
        return key && t.has(key) ? t(key) : status;
    };
    const locale = await getLocale();
    const dateTag = dateLocaleTag(locale);
    const session = await auth();

    if (!session?.user) {
        redirect({ href: "/auth/login", locale });
    }

    // The screen this module declares `blog.manage` for. The door will check
    // the same name once enforcement moves there; until then the page asks,
    // because a screen that lets somebody in and then refuses every write is
    // worse than one that says no at the top.
    if (!(await hasPermission(session.user.id, "blog.manage"))) {
        redirect({ href: "/", locale });
    }

    const raw = (await searchParams)?.page;
    const requested = Number.parseInt(Array.isArray(raw) ? raw[0] : raw ?? "", 10);
    const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
    const { articles, stats } = await getBlogArticles(page);

    const draftCount = stats.find(s => s.status === "DRAFT")?._count || 0;
    const publishedCount = stats.find(s => s.status === "PUBLISHED")?._count || 0;
    // The count card asks how many articles exist, not how many are on screen.
    const totalCount = stats.reduce((sum, s) => sum + s._count, 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

    return (
        <>
            <AdminPageHeader
                title={t("adm_blogArticles")}
                description={t("adm_manageBlogContent")}
                actions={<>
                    <Link href="/admin/blog/articles/new" className={buttonClassName("default", "default")}>{`+ ${t("adm_newArticle")}`}</Link>
                </>}
            />

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            {t("adm_totalArticles")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalCount}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            {t("adm_published")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-success">{publishedCount}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                            {t("adm_drafts")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-warning">{draftCount}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Articles Table */}
            <Card>
                <CardHeader>
                    <CardTitle>{t("adm_allArticles")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {articles.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {t("adm_noArticlesYet")}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr>
                                        <th className="text-left py-3 px-4 font-medium">{t("adm_titleCol")}</th>
                                        <th className="text-left py-3 px-4 font-medium">{t("adm_category")}</th>
                                        <th className="text-left py-3 px-4 font-medium">{t("adm_author")}</th>
                                        <th className="text-left py-3 px-4 font-medium">{t("adm_status")}</th>
                                        <th className="text-left py-3 px-4 font-medium">{t("adm_views")}</th>
                                        <th className="text-left py-3 px-4 font-medium">{t("adm_date")}</th>
                                        <th className="text-right py-3 px-4 font-medium">{t("adm_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {articles.map((article) => (
                                        <tr key={article.id} className="hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <div>
                                                    <p className="font-medium">{article.title}</p>
                                                    <p className="text-sm text-muted-foreground">/{article.slug}</p>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="text-sm">
                                                    {article.category?.name || "-"}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="text-sm">{article.author?.username ?? "-"}</span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span
                                                    className={`text-xs px-2 py-1 rounded ${article.status === "PUBLISHED"
                                                        ? "bg-success/20 text-success"
                                                        : article.status === "DRAFT"
                                                            ? "bg-warning/20 text-warning"
                                                            : "bg-muted text-muted-foreground"
                                                        }`}
                                                >
                                                    {statusLabel(article.status)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="text-sm">{article.views}</span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="text-sm text-muted-foreground">
                                                    {formatDate(article.createdAt, undefined, dateTag)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <Link
                                                    href={`/admin/blog/articles/${article.id}/edit`}
                                                    className="text-primary hover:underline text-sm mr-3"
                                                >
                                                    {t("adm_edit")}
                                                </Link>
                                                <Link
                                                    href={`/blog/${article.number}/${article.slug}`}
                                                    target="_blank"
                                                    className="text-muted-foreground hover:underline text-sm"
                                                >
                                                    {t("adm_view")}
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Pagination page={page} pages={totalPages} total={totalCount} pageParam="page" />
                </CardContent>
            </Card>
        </>
    );
}
