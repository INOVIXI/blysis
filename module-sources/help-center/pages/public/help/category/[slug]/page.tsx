/**
 * One section of the help centre, written by the server.
 *
 * It fetched the section and its articles after the page had loaded, so this
 * step of the path from the help centre to an article carried no link in the
 * HTML the server sent - which broke the chain whether or not the two pages at
 * either end of it were fixed.
 *
 * The page number is an address, so a section with thirty articles has a
 * second page somebody can link to.
 */
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Pagination } from "@/core/sdk/ui";
import { Eye } from "lucide-react";
import { readHelpCategory } from "../../../../../lib/read-article";

const PER_PAGE = 24;

interface PageProps {
    params: Promise<{ slug: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HelpCategoryPage({ params, searchParams }: PageProps) {
    const { slug } = await params;
    const query = (await searchParams) ?? {};
    const requested = Number.parseInt((Array.isArray(query.page) ? query.page[0] : query.page) ?? "", 10);
    const page = Number.isFinite(requested) && requested > 0 ? requested : 1;

    const read = await readHelpCategory(slug);
    // A section that is not there is a 404, not a page saying it is not there.
    if (!read) notFound();

    const t = await getTranslations("helpCenter");
    const pages = Math.max(1, Math.ceil(read.articles.length / PER_PAGE));
    const rows = read.articles.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    return (
        <PageFrame
            title={read.category.name}
            description={read.category.description || undefined}
            trail={[{ label: t("title"), href: "/help" }]}
        >
            {rows.length === 0 ? (
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground">{t("noArticlesInCategory")}</p>
                </div>
            ) : (
                <>
                    {/* One card per article rather than a stack of links: a row
                        that only carries a title reads as a list of the same
                        thing, and a category with thirty of them had no way to
                        stop scrolling. */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {rows.map((article) => (
                            <Link
                                key={article.id}
                                href={`/help/${article.slug}`}
                                className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted"
                            >
                                <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                                    {article.title}
                                </span>
                                {article.views !== null && (
                                    <span className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                                        <Eye className="w-3 h-3" aria-hidden="true" />
                                        {t("views", { count: article.views })}
                                    </span>
                                )}
                            </Link>
                        ))}
                    </div>
                    {pages > 1 && <Pagination className="mt-6" page={page} pages={pages} total={read.articles.length} pageParam="page" />}
                </>
            )}
        </PageFrame>
    );
}
