import { NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { DOWNLOAD_TEXT } from "../../../lib/validations";

type RouteParams = { params: Promise<{ number: string }> };

/**
 * One download, with its instructions.
 *
 * Resolved by the number rather than the slug, so renaming a file does not
 * break a link. A download with nothing in `details` has no page and answers
 * 404 here rather than serving a page that repeats the row in the list; the
 * same 404 covers one that has been switched off, so a visitor cannot read a
 * retired file's guide by guessing its number.
 *
 * The download count is not incremented here. This is somebody reading the
 * instructions, which is not the same as taking the file, and counting it
 * would make the number on the list mean two different things.
 *
 * Read in `?locale=`, and in the original where the admin wrote no
 * translation. Whether there is a guide at all is the original's to say.
 */
export async function GET(request: Request, { params }: RouteParams) {
    const { number } = await params;
    const id = Number(number);
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = await prisma.download.findUnique({
        where: { number: id },
        select: {
            id: true, number: true, slug: true, title: true, description: true,
            details: true, coverImage: true, fileName: true, fileSize: true,
            downloads: true, isActive: true, updatedAt: true,
        },
    });

    if (!row || !row.isActive || !row.details || row.details.trim() === "") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { isActive: _isActive, ...guided } = row;
    const locale = new URL(request.url).searchParams.get("locale") ?? "";
    const [download] = await translateContent(prisma, DOWNLOAD_TEXT, [guided], ["title", "description", "details"], locale);
    return NextResponse.json({ download });
}
