/**
 * The files, written by the server.
 *
 * The list fetched them after the page had loaded, so the HTML the server sent
 * carried no file name, no description and no link to a guide: measured, 64
 * characters of text inside `<main>`. The page number is an address now too.
 *
 * The button on each row stays a client component - it asks for a link issued
 * per request - and it is the only part of the row that does.
 */
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Card, CardContent, Pagination, RichContent } from "@/core/sdk/ui";
import { FileText } from "lucide-react";
import { formatFileSize, guideHref } from "../../lib/guide";
import { readDownloads } from "../../lib/read-downloads";
import { DownloadButton } from "../../components/DownloadButton";

const PER_PAGE = 10;

interface PageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DownloadsPage({ searchParams }: PageProps) {
    const query = (await searchParams) ?? {};
    const asked = Number.parseInt((Array.isArray(query.page) ? query.page[0] : query.page) ?? "", 10);
    const page = Number.isFinite(asked) && asked > 0 ? asked : 1;

    const t = await getTranslations("downloads");
    const downloads = await readDownloads();
    const pages = Math.max(1, Math.ceil(downloads.length / PER_PAGE));
    const rows = downloads.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    return (
        <PageFrame title={t("title")} description={t("subtitle")}>
            {rows.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("empty")}</CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {rows.map((dl) => {
                        const href = dl.hasGuide ? guideHref({ ...dl, details: "x" }) : null;
                        return (
                            <Card key={dl.id} className="hover:shadow-md transition-shadow">
                                <CardContent className="p-4 flex items-center gap-4">
                                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                        <FileText className="w-6 h-6 text-primary" aria-hidden="true" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {/* A link only where there is a guide behind it. A
                                            title that leads to a repeat of the line below
                                            teaches a reader to stop following links. */}
                                        <h2 className="font-medium text-foreground">
                                            {href ? (
                                                <Link href={href} className="hover:text-primary transition-colors">{dl.title}</Link>
                                            ) : dl.title}
                                        </h2>
                                        {/* The description is a rich text field in the admin
                                            form and was rendered as a plain string here, so an
                                            operator who used any formatting saw their own
                                            markup printed on the page. */}
                                        {dl.description && (
                                            <RichContent
                                                as="div"
                                                className="text-sm text-muted-foreground line-clamp-1"
                                                markdown={dl.description}
                                            />
                                        )}
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                            <span>{dl.fileName}</span>
                                            <span>{formatFileSize(dl.fileSize, t("unknownSize"))}</span>
                                            <span>{t("downloadsCount", { count: dl.downloads })}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {href && (
                                            <Link
                                                href={href}
                                                // Beside the file it belongs to on screen, and
                                                // named for it everywhere else: a list of files
                                                // each offering "How to use it" says nothing
                                                // about which file.
                                                aria-label={t("readGuideFor", { title: dl.title })}
                                                className="text-sm text-primary hover:underline whitespace-nowrap"
                                            >
                                                {t("readGuide")}
                                            </Link>
                                        )}
                                        <DownloadButton id={dl.id} />
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                    {pages > 1 && <Pagination page={page} pages={pages} total={downloads.length} pageParam="page" />}
                </div>
            )}
        </PageFrame>
    );
}
