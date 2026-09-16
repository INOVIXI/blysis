import { NextRequest, NextResponse } from "next/server";
import { slugify } from "@/core/sdk";
import { isAdmin, log, moduleSettings, pageParams, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { productSchema } from "../../lib/validations";
import { availabilityData } from "../../lib/availability-input";
import { PUBLIC_PRODUCT } from "../../lib/public-product";
import { availabilityOf, effectivePrice } from "../../lib/availability";
import { pricedForCampaign, runningCampaignEntries } from "../../lib/campaign-server";
import { hideShut, onTheShelfWhere, rulesOf, type ProductRow } from "../../lib/availability-server";
import { siteTimeZone } from "@/core/sdk/server";

/**
 * The listing is the same whoever asked - it reads no session - but it is no
 * longer the same at every moment: a product may open at 18:00 and shut at
 * 22:00, and a shared cache would keep serving the shut answer into the
 * opening, or the open one past it. Thirty seconds was already short; five
 * keeps the window honest while still absorbing a burst.
 */
const SHARED_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=10" };


// GET /api/v1/store/products - List products
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: 12 });
        const category = searchParams.get("category");
        const featured = searchParams.get("featured") === "true";
        const search = searchParams.get("search") || "";
        const sort = searchParams.get("sort") || "newest";

        // Always. A product an operator switched off is not on the shelf,
        // and this answer is public: it used to drop the filter for anyone
        // who wrote `?all=true`, and since it became something a proxy may
        // hold, that answer would have been cached and served as well as
        // computed. The screen that needs the full list asks
        // /api/v1/store/admin/products, which checks who is asking.
        const now = new Date();
        const where = {
            ...onTheShelfWhere(now),
            ...(category && { category: { slug: category } }),
            ...(featured && { isFeatured: true }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { description: { contains: search, mode: "insensitive" as const } },
                ],
            }),
        };

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                select: PUBLIC_PRODUCT,
                skip,
                take,
                // Popularity is a column now. It used to be a `groupBy` over
                // every paid order item, complete before a page of it could be
                // cut, which measured 90 ms against a shop with 150,000 order
                // items; `unitsSold` is maintained where the sale happens and
                // reads in 1 ms behind (isActive, unitsSold). A product nobody
                // has bought sits at zero and therefore after the ones people
                // have, which is where the old two-list dance was going.
                orderBy: sort === "popular" ? [{ unitsSold: "desc" as const }, { createdAt: "desc" as const }]
                    : sort === "price_asc" ? { price: "asc" as const }
                    : sort === "price_desc" ? { price: "desc" as const }
                    : { createdAt: "desc" as const },
            }),
            prisma.product.count({ where }),
        ]);

        // The hour of a weekly window is applied here rather than in SQL: see
        // hideShut. A product an operator asked to hide while it is shut is
        // gone from the list; one set to count down is still listed, with the
        // state that says so.
        const zone = await siteTimeZone();
        // Once for the whole page. A shop runs few campaigns and asking each
        // product for its entry would be a query a line.
        const campaignEntries = await runningCampaignEntries(prisma, now, zone);
        const { lowStockAt } = await moduleSettings<{ lowStockAt: number }>("store");
        const onShelf = hideShut(products as unknown as ProductRow[], now, zone);
        const annotated = onShelf.map((row) => {
            const rules = rulesOf(row);
            // Nobody in particular: this answer is shared-cached, so it
            // carries no per-person counting and no rank. Judging the rank
            // here would tell a VIP their own product is not for them, since
            // the same answer is served to everybody; `restricted` below says
            // a rank is needed and the product page, which knows the reader,
            // says whether it is theirs.
            const state = availabilityOf(
                { ...rules, roleIds: [] },
                { boughtByPerson: 0, soldInPeriod: 0 },
                now,
                zone,
            );
            return {
                ...row,
                availability: {
                    state: state.state,
                    buyable: state.buyable,
                    opensAt: state.opensAt,
                    closesAt: state.closesAt,
                    // Not who may buy it - this answer is shared - only that
                    // somebody may not. The card wears a badge; the product
                    // page, which knows the reader, says the rest.
                    restricted: row.roleIds.length > 0,
                },
                ...pricedForCampaign(row.id, effectivePrice(rules, now), campaignEntries),
            };
        });

        return NextResponse.json({
            products: annotated,
            // What counts as "nearly gone" is the operator's, and the card
            // has to know it to say so.
            lowStockAt,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        }, { headers: SHARED_CACHE });
    } catch (error) {
        log.error("List products error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// POST /api/v1/store/products - Create product (admin)
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const adminCheck = await isAdmin(session.user.id);
        if (!adminCheck) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = productSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const data = validation.data;
        const slug = data.slug || slugify(data.name);

        // Check if slug exists
        const existing = await prisma.product.findUnique({ where: { slug } });
        if (existing) {
            return NextResponse.json(
                { error: "A product with this slug already exists" },
                { status: 400 }
            );
        }

        const product = await prisma.product.create({
            data: {
                name: data.name,
                slug,
                description: data.description !== undefined ? data.description : data.description,
                shortDesc: data.shortDesc,
                price: data.price,
                comparePrice: data.comparePrice,
                image: data.image,
                images: data.images || [],
                stock: data.stock,
                isActive: data.isActive ?? true,
                isFeatured: data.isFeatured ?? false,
                type: data.type || "DIGITAL",
                categoryId: data.categoryId,
                deliveryData: data.deliveryData,
                subscriptionInterval: data.type === "SUBSCRIPTION" ? data.subscriptionInterval : null,
                subscriptionIntervalCount: data.type === "SUBSCRIPTION" ? data.subscriptionIntervalCount : null,
                ...(await availabilityData(data)),
            },
            include: {
                category: true,
            },
        });

        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("store.product.created", product);

        return NextResponse.json({ product }, { status: 201 });
    } catch (error) {
        log.error("Create product error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
