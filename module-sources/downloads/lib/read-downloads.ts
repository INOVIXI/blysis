/**
 * The files on offer, read on the server.
 *
 * The list fetched them after the page had loaded, so the HTML the server sent
 * carried no file, no description and no link to a guide: measured, 64
 * characters of text inside `<main>`.
 *
 * The guide itself is left out on purpose. The list renders none of it and it
 * is a page's worth of markup per row; what the list needs is whether there is
 * a page to link to.
 */
import { prisma, translateContent } from "@/core/sdk/server";
import { DOWNLOAD_TEXT } from "./validations";

/**
 * In the reader's `locale`, and in the original where the admin wrote no
 * translation. Whether a file has a guide is the original's to say.
 */
export async function readDownloads(locale = "") {
    const rows = await prisma.download.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
            id: true, number: true, slug: true, title: true, description: true,
            fileName: true, fileSize: true, downloads: true, createdAt: true,
            details: true,
        },
    });
    const listed = rows.map(({ details, ...row }) => ({
        ...row,
        hasGuide: typeof details === "string" && details.trim() !== "",
    }));
    return translateContent(prisma, DOWNLOAD_TEXT, listed, ["title", "description"], locale);
}
