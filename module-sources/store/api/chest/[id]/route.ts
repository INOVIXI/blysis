import { NextRequest, NextResponse } from "next/server";
import { log, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { deliverProduct } from "../../../lib/delivery";
import { deliveryFor } from "../../../lib/chest";
import { chestRedeemSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/v1/chest/[id] - Redeem chest item (deliver to game)
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await rateLimitForRole(
        `chest-redeem:${session.user.id}`,
        { maxRequests: 30, windowMs: 15 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { id } = await params;
    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;

    const parsed = chestRedeemSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const item = await prisma.chestItem.findUnique({ where: { id } });
    if (!item || item.userId !== session.user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (item.isRedeemed) return NextResponse.json({ error: "Already redeemed" }, { status: 400 });

    // Gift to another user
    if (fields.giftTo) {
        // Both switches are read here rather than trusted from the screen:
        // the button is hidden when gifting is off, and a hidden button is
        // not a check.
        const { enableChestGifting } = await moduleSettings<{ enableChestGifting: boolean }>("store");
        if (enableChestGifting === false) {
            return NextResponse.json(
                { error: "Gifting is turned off", code: "chest_gifting_off" },
                { status: 403 },
            );
        }
        const product = await prisma.product.findUnique({
            where: { id: item.productId },
            select: { giftable: true },
        });
        if (!product?.giftable) {
            return NextResponse.json(
                { error: "This one cannot be given away", code: "chest_item_not_giftable" },
                { status: 403 },
            );
        }

        const target = await prisma.user.findFirst({
            where: { OR: [{ username: fields.giftTo }, { id: fields.giftTo }] },
        });
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

        // Conditional on the row still being this user's and unredeemed, so a
        // gift racing a redeem cannot both win.
        const gifted = await prisma.chestItem.updateMany({
            where: { id, userId: session.user.id, isRedeemed: false },
            data: { userId: target.id, giftedToId: target.id },
        });
        if (gifted.count === 0) {
            return NextResponse.json({ error: "Already redeemed" }, { status: 400 });
        }

        return NextResponse.json({ message: `Gifted to ${target.username}` });
    }

    const commands = await prisma.productCommand.findMany({
        where: { productId: item.productId },
        orderBy: { order: "asc" },
    });

    // Everything the request can be turned away for is settled before the
    // claim, because a refusal after it spends the item: the screen asks for
    // a name, the answer comes back, and the second attempt is told the item
    // was already redeemed. It was, to nobody.
    const delivery = commands.length > 0
        ? deliveryFor(item, { playerName: fields.playerName })
        : null;
    if (delivery && "needsPlayerName" in delivery) {
        // Nothing was recorded and nothing was typed. This used to fall back
        // to the account's username, which is the one name checkout
        // deliberately does not use, so the commands ran for the wrong person.
        return NextResponse.json(
            { error: "Tell us which player to deliver to", code: "chest_needs_player_name" },
            { status: 400 },
        );
    }

    // Claim the item before delivering it, not after.
    //
    // The read above and the write below used to sit on either side of the
    // RCON delivery: two requests that arrived together both read
    // `isRedeemed: false`, both ran the commands, and the player received the
    // item twice. The gift-code route has always claimed with a conditional
    // updateMany for exactly this reason; this one did not.
    //
    // Delivery failure does not hand the item back, which is what the old code
    // did too - it delivered with `.catch(console.error)` and marked the item
    // redeemed regardless.
    const claimed = await prisma.chestItem.updateMany({
        where: { id, userId: session.user.id, isRedeemed: false },
        data: { isRedeemed: true, redeemedAt: new Date() },
    });
    if (claimed.count === 0) {
        return NextResponse.json({ error: "Already redeemed" }, { status: 400 });
    }

    if (delivery && !("needsPlayerName" in delivery)) {
        await deliverProduct({
            playerName: delivery.playerName,
            productName: delivery.productName,
            commands: commands.map((c) => ({ command: c.command, serverId: c.serverId })),
            quantity: delivery.quantity,
            variables: delivery.variables,
        }).catch((err: unknown) => log.error("[store] delivering a chest reward failed", { error: err instanceof Error ? err.message : String(err) }));
    }

    return NextResponse.json({ message: "Item redeemed" });
}
