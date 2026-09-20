import { NextResponse } from "next/server";
import { moduleSettings, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * GET /api/v1/chest - what a member has bought and not yet claimed.
 *
 * Each row says whether it may be handed to somebody else, because the screen
 * draws a Gift button and the answer is two settings deep: the site decides
 * whether gifting exists at all, and the product decides whether it is one of
 * the things that travels. Without it the button was drawn on everything and
 * the refusal arrived after the click.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Bounded: a chest is one person's and usually short, but it grows by
    // one row per line of every order they never claimed, and nothing has
    // ever trimmed it.
    const items = await prisma.chestItem.findMany({
        where: { userId: session.user.id, isRedeemed: false },
        orderBy: { createdAt: "desc" },
        take: 200,
    });

    const { enableChestGifting } = await moduleSettings<{ enableChestGifting: boolean }>("store");
    // Absent means on: a site that has never opened the shop's settings has
    // no row, and gifting worked before there was a switch.
    const siteAllowsGifting = enableChestGifting !== false;

    const travels = new Set<string>();
    if (siteAllowsGifting && items.length > 0) {
        const productIds = [...new Set(items.map((item) => item.productId))];
        const giftable = await prisma.product.findMany({
            where: { id: { in: productIds }, giftable: true },
            select: { id: true },
            take: productIds.length,
        });
        for (const product of giftable) travels.add(product.id);
    }

    return NextResponse.json({
        // A row whose product has since been deleted is not giftable. Nothing
        // is left to ask, and refusing is the answer that cannot move
        // something an operator meant to keep in one place.
        items: items.map((item) => ({ ...item, canGift: travels.has(item.productId) })),
        giftingEnabled: siteAllowsGifting,
    });
}
