/**
 * Every page this site serves, with what it says about itself and whatever has
 * been said over the top of it.
 *
 * One request rather than two: the screen draws a default beside an override
 * on every row, and fetching the catalogue and the overrides separately meant
 * the first paint showed defaults that were about to be replaced.
 *
 * The catalogue comes from core, which is the only part that knows what is
 * installed. This module cannot enumerate other modules' pages and must not
 * try.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin, listCataloguePages, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // The operator's own language, sent by the screen. next-intl reads a locale
    // from a route segment and an API route has none, so asked from here it
    // would answer every default in the key it is stored under.
    const locale = request.nextUrl.searchParams.get("locale") || "";

    const [pages, overrides] = await Promise.all([
        listCataloguePages(locale),
        prisma.seoPage.findMany({ orderBy: { path: "asc" } }),
    ]);

    return NextResponse.json({ pages, overrides });
}
