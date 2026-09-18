import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { refuseSilenced, logActivity, pageParams, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { LISTINGS_PER_PAGE, readListings } from "../../lib/read-listings";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { deliveryRefusal } from "../../lib/delivery";
import { readListingPayload } from "../../lib/payload";

/**
 * What is for sale, and putting something up.
 *
 * The listing carries a kind rather than a thing. Which kinds exist is asked
 * of whatever is installed, both here - so a seller cannot offer something
 * nothing can hand over - and again when it sells.
 */
const listingSchema = z.object({
    title: z.string().min(1, "A title is required").max(120),
    body: z.string().max(2000).optional(),
    price: z.number().int().min(1, "A listing has to cost at least one credit").max(10_000_000),
    kind: z.string().min(1).max(64),
    /**
     * Shaped by `lib/payload.ts` rather than here. A schema saying
     * `Record<string, string>` was this module deciding the shape of
     * something it says it knows nothing about, and the first provider ever
     * built - a rank for a number of days - could not be listed because of
     * it.
     */
    payload: z.unknown().optional(),
});

// The read and what counts as on sale live in lib/read-listings.ts, because
// the page renders the board on the server now and the two must not drift.
export async function GET(request: NextRequest) {
    // Through the shared reader rather than parsed here: it is the one place
    // that bounds a page number, and a `?page=1e9` skipping a billion rows is
    // a query nobody can serve.
    const { page } = pageParams(request.nextUrl.searchParams, { defaultLimit: LISTINGS_PER_PAGE });
    const read = await readListings(page);

    return NextResponse.json({
        listings: read.listings.map((listing) => ({
            id: listing.id,
            title: listing.title,
            body: listing.body,
            price: listing.price,
            kind: listing.kind,
            seller: listing.seller,
            createdAt: listing.createdAt,
        })),
        pagination: { page: read.page, pages: read.pages, total: read.total },
    });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    const rl = await rateLimitForRole(
        `market-list:${session.user.id}`,
        { maxRequests: 20, windowMs: 60 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = listingSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const carried = readListingPayload(parsed.data.payload);
    if ("refuse" in carried) {
        return NextResponse.json(
            { error: "That listing carries something this cannot store", code: "market_bad_payload" },
            { status: 400 },
        );
    }

    // Nothing can be listed that nothing can hand over. Checked again at the
    // sale, because a module gets uninstalled and its listings outlive it.
    const kinds = await applyFiltersAsync("marketplace.delivery.kinds", [], {});
    if (deliveryRefusal(parsed.data.kind, kinds)) {
        return NextResponse.json(
            { error: "Nothing here can hand that over", code: "market_cannot_deliver" },
            { status: 400 },
        );
    }

    const listing = await prisma.marketListing.create({
        data: {
            sellerId: session.user.id,
            title: parsed.data.title,
            body: parsed.data.body ?? null,
            price: parsed.data.price,
            kind: parsed.data.kind,
            // What the reader kept, not what arrived: the two differ
            // wherever it dropped something, and storing the raw one
            // would put back exactly what was refused.
            payload: carried.payload ?? {},
        },
    });

    await logActivity({
        userId: session.user.id,
        action: "marketplace.listing.created",
        entity: "market_listing",
        entityId: listing.id,
        metadata: { price: listing.price, kind: listing.kind },
    }).catch(() => {});

    return NextResponse.json({ listing }, { status: 201 });
}
