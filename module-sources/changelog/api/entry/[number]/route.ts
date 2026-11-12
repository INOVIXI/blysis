import { NextResponse } from "next/server";
import { readChangelogKinds } from "../../../lib/read-entries";
import { prisma, translateContent } from "@/core/sdk/server";
import { ENTRY_TEXT } from "../../../lib/entry-page";

type RouteParams = { params: Promise<{ number: string }> };

/**
 * One release, in full.
 *
 * Resolved by the number rather than the slug: the slug follows the title and
 * an operator fixing a typo must not break a link somebody has shared. The
 * slug in the URL is for the reader and is not checked, the same way an
 * article works.
 *
 * An entry with nothing in `details` has no page, so this answers 404 for it
 * rather than serving a page that repeats the line already on the timeline.
 * The same 404 covers an entry that is switched off or not published yet: a
 * visitor may not read a draft by guessing its number.
 *
 * Read in `?locale=`, and in the original where the admin wrote no
 * translation. Whether there is a page at all is the original's to say.
 */
export async function GET(request: Request, { params }: RouteParams) {
    const { number } = await params;
    const id = Number(number);
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const entry = await prisma.changelogEntry.findUnique({
        where: { number: id },
        select: {
            id: true, number: true, slug: true, version: true, title: true,
            content: true, details: true, coverImage: true, type: true,
            color: true, createdAt: true, isActive: true, publishAt: true,
        },
    });

    const published =
        entry?.isActive === true &&
        (entry.publishAt === null || entry.publishAt <= new Date());

    if (!entry || !published || !entry.details || entry.details.trim() === "") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { isActive: _isActive, publishAt: _publishAt, ...original } = entry;
    const locale = new URL(request.url).searchParams.get("locale") ?? "";
    const [body] = await translateContent(prisma, ENTRY_TEXT, [original], ["title", "content", "details"], locale);
    /*
     * The kinds travel with the entry.
     *
     * The page draws a badge whose word and colour come from the kind this
     * release was written under, and asking a second endpoint for that would
     * mean a second public route whose only job is to be read by one page -
     * and a second round trip before the badge settles.
     */
    return NextResponse.json({ entry: body, kinds: await readChangelogKinds() });
}
