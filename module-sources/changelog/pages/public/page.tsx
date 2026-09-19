/**
 * The timeline, written by the server.
 *
 * It fetched its entries after the page had loaded, so the HTML the server
 * sent carried no entry, no title and no link to an entry's own page:
 * measured, 61 characters of text inside `<main>`.
 *
 * The page number is an address now, so a release from two years ago can be
 * linked to rather than only scrolled to.
 */
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Badge, Card, CardContent, Pagination, RichContent } from "@/core/sdk/ui";
import { formatDate, dateLocaleTag } from "@/core/sdk";
import { getLocale } from "next-intl/server";
import { changelogTone, changelogKindLabel } from "../../lib/types";
import { entryHref } from "../../lib/entry-page";
import { readChangelogEntries, readChangelogKinds } from "../../lib/read-entries";

const PER_PAGE = 10;

interface PageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChangelogPage({ searchParams }: PageProps) {
    const query = (await searchParams) ?? {};
    const asked = Number.parseInt((Array.isArray(query.page) ? query.page[0] : query.page) ?? "", 10);
    const page = Number.isFinite(asked) && asked > 0 ? asked : 1;

    const t = await getTranslations("changelog");
    const dateTag = dateLocaleTag(await getLocale());
    // The two reads are independent, so they go together.
    const [entries, kinds] = await Promise.all([readChangelogEntries(), readChangelogKinds()]);
    const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    const rows = entries.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    return (
        <PageFrame title={t("title")} description={t("subtitle")}>
            {rows.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("empty")}</CardContent></Card>
            ) : (
                <div>
                    {/* The rail is drawn inside the list, not around the whole
                        block. Spanning the outer container ran it down through
                        the pagination underneath, so the line crossed the row
                        count and the page numbers. */}
                    <div className="relative">
                        <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-border" />
                        <div className="space-y-6">
                            {rows.map((entry) => {
                                const href = entry.hasDetails ? entryHref({ ...entry, details: "x" }) : null;
                                return (
                                    <div key={entry.id} className="relative pl-12">
                                        {/* The marker read "v" on every release,
                                            which told a reader nothing the shape
                                            of the page had not already said. */}
                                        <div className="absolute left-0 top-1 w-10 h-10 rounded-full bg-card border-2 border-border flex items-center justify-center z-10">
                                            <span className="text-[11px] font-bold text-foreground tabular-nums">
                                                {entry.version.split(".").slice(0, 2).join(".")}
                                            </span>
                                        </div>
                                        <Card>
                                            <CardContent className="p-5">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge tone={changelogTone(entry.type, kinds)}>
                                                        {changelogKindLabel(t, entry.type, kinds)}
                                                    </Badge>
                                                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-mono">
                                                        v{entry.version}
                                                    </span>
                                                    {/* An absolute date: the server has no reader's
                                                        clock, and a relative one rendered here is
                                                        wrong by the time it is read. */}
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatDate(entry.createdAt, undefined, dateTag)}
                                                    </span>
                                                </div>
                                                {/* A link only where there is something behind it.
                                                    A title that leads to a copy of the line below
                                                    teaches a reader the links here are not worth
                                                    following. */}
                                                {href ? (
                                                    <h2 className="font-bold text-foreground mb-2">
                                                        <Link href={href} className="hover:text-primary transition-colors">
                                                            {entry.title}
                                                        </Link>
                                                    </h2>
                                                ) : (
                                                    <h2 className="font-bold text-foreground mb-2">{entry.title}</h2>
                                                )}
                                                <RichContent className="text-sm text-muted-foreground" markdown={entry.content} />
                                                {href && (
                                                    <Link href={href} className="mt-3 inline-flex text-sm text-primary hover:underline">
                                                        {t("readMore")}
                                                    </Link>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {pages > 1 && (
                        <Pagination className="mt-6" page={page} pages={pages} total={entries.length} pageParam="page" />
                    )}
                </div>
            )}
        </PageFrame>
    );
}
