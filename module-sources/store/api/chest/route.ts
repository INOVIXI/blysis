import { NextRequest, NextResponse } from "next/server";
import { moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { PENDING, receivesGifts, sentGifts, setReceivesGifts } from "../../lib/gifts";
import { chestSettingsSchema } from "../../lib/validations";

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

    const senderIds = [...new Set(items.map((item) => item.giftedById).filter((v): v is string => Boolean(v)))];
    const senders = senderIds.length
        ? new Map(
              (
                  await prisma.user.findMany({
                      where: { id: { in: senderIds } },
                      select: { id: true, username: true },
                      take: senderIds.length,
                  })
              ).map((u) => [u.id, u.username]),
          )
        : new Map<string, string>();

    const [sent, receiveGifts] = await Promise.all([sentGifts(session.user.id, { inGame: false }), receivesGifts(session.user.id)]);

    return NextResponse.json({
        // A row whose product has since been deleted is not giftable. Nothing
        // is left to ask, and refusing is the answer that cannot move
        // something an operator meant to keep in one place. A gift that is
        // still waiting cannot be passed on before it is accepted.
        items: items.map((item) => ({
            ...item,
            pendingGift: item.giftState === PENDING,
            from: item.giftedById ? (senders.get(item.giftedById) ?? null) : null,
            canGift: item.giftState !== PENDING && travels.has(item.productId),
        })),
        sent,
        receiveGifts,
        giftingEnabled: siteAllowsGifting,
    });
}

/** PATCH /api/v1/chest - whether this member takes gifts at all. */
export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rl = await rateLimitForRole(`chest-settings:${session.user.id}`, { maxRequests: 20, windowMs: 60_000 }, session.user.role);
    if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = chestSettingsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const receiveGifts = await setReceivesGifts(session.user.id, parsed.data.receiveGifts);
    return NextResponse.json({ receiveGifts });
}
