/**
 * The help centre, written by the server.
 *
 * It fetched its categories and its popular articles after the page had
 * loaded, so the HTML the server sent held no link to a single article or a
 * single section: measured, the page answered with 17 links and every one of
 * them was the shared header and footer. The 30 articles the sitemap publishes
 * had no path into them from anywhere on the site.
 *
 * The search is an address now rather than client state, which is what lets a
 * result page be shared at all.
 */
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame, StandardSidebarLayout } from "@/core/sdk/layout";
import { BookOpen, CreditCard, Info, Package, User, Wrench, type LucideIcon } from "lucide-react";
import { readHelpIndex, searchHelpArticles } from "../../../lib/read-article";
import { HelpSearch } from "../../../components/HelpSearch";

interface PageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** A small fixed set, named so a bundler keeps only these six. */
const ICONS: Record<string, LucideIcon> = {
    account: User,
    payment: CreditCard,
    order: Package,
    technical: Wrench,
    general: Info,
};

export default async function HelpCenterPage({ searchParams }: PageProps) {
    const query = (await searchParams) ?? {};
    const raw = Array.isArray(query.q) ? query.q[0] : query.q;
    const term = raw?.trim() ?? "";

    const t = await getTranslations("helpCenter");
    const [{ categories, popular }, results] = await Promise.all([
        readHelpIndex(),
        searchHelpArticles(term),
    ]);

    return (
        <PageFrame title={t("title")}>
            {/* The band is the search, and it is drawn on the primary colour:
                a line of text-primary on it was the colour it was printed on,
                so the invitation to search was invisible. */}
            <div className="bg-gradient-to-r from-primary to-accent rounded-2xl p-8 text-white mb-8">
                <h2 className="text-2xl font-bold mb-2">{t("heading")}</h2>
                <p className="text-white/80 mb-6">{t("subtitle")}</p>
                <HelpSearch initial={term} />
            </div>

            {term && (
                <div className="bg-card rounded-xl border border-border p-6 mb-8">
                    <h2 className="font-bold text-lg mb-4">{t("searchResults")} ({results.length})</h2>
                    {results.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("noArticlesYet")}</p>
                    ) : (
                        <ul className="space-y-2">
                            {results.map((article) => (
                                <li key={article.id}>
                                    <Link href={`/help/${article.slug}`} className="text-primary hover:underline">
                                        {article.title}
                                    </Link>
                                    {article.category && (
                                        <span className="text-muted-foreground text-sm ml-2">
                                            {t("inCategory", { category: article.category.name })}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <StandardSidebarLayout
                heading={t("browseCategories")}
                sidebar={(
                    <div>
                        <div className="bg-card rounded-xl border border-border p-6">
                            <h3 className="font-bold text-foreground mb-4">{t("popularArticles")}</h3>
                            {popular.length > 0 ? (
                                <ul className="space-y-3">
                                    {popular.map((article) => (
                                        <li key={article.id}>
                                            <Link href={`/help/${article.slug}`} className="text-primary hover:underline text-sm">
                                                {article.title}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">{t("noArticlesYet")}</p>
                            )}
                        </div>

                        <div className="bg-card rounded-xl border border-border p-6 mt-4">
                            <h3 className="font-bold text-foreground mb-2">{t("needHelp")}</h3>
                            <p className="text-sm text-muted-foreground mb-4">{t("cantFind")}</p>
                            <Link href="/support/new" className="text-primary hover:underline text-sm font-medium">
                                {t("createTicket")} →
                            </Link>
                        </div>
                    </div>
                )}
            >
                <div>
                    <div className="grid md:grid-cols-2 gap-4">
                        {categories.map((category) => {
                            const Icon = ICONS[category.icon || ""] || BookOpen;
                            return (
                                <Link key={category.id} href={`/help/category/${category.slug}`}>
                                    <div className="bg-card rounded-xl border border-border p-6 hover:shadow-md transition-shadow">
                                        <div className="flex items-start gap-4">
                                            <Icon className="w-8 h-8 text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                                            <div>
                                                <h3 className="font-bold text-foreground">{category.name}</h3>
                                                {category.description && (
                                                    <p className="text-sm text-muted-foreground mt-1">{category.description}</p>
                                                )}
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    {t("articles", { count: category.articleCount })}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>

                    {categories.length === 0 && (
                        <div className="bg-card rounded-xl p-8 text-center">
                            <p className="text-muted-foreground">{t("noCategories")}</p>
                        </div>
                    )}
                </div>
            </StandardSidebarLayout>
        </PageFrame>
    );
}
