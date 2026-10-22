import { NextRequest, NextResponse } from "next/server";
import { doActionAsync } from "@/core/sdk";
import { log, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { activateGift, cancelGift, claimChestItem, PENDING } from "../../../lib/gifts";
import { chestRedeemSchema } from "../../../lib/validations";
import { isPlayerName } from "../../../lib/player-name";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/chest/[id] - claim a chest item, give it away, or settle a gift.
 *
 * With no action and no recipient the item is claimed and sent to the game.
 * `giftTo` hands it to another member, where it waits as a pending gift until
 * they accept it. `action: "activate"` is the recipient accepting one, and
 * `action: "cancel"` is the sender taking one back. The rules for all of it
 * live in `lib/gifts.ts`, which a game server asks too.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;

    const rl = await rateLimitForRole(
        `chest-redeem:${userId}`,
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
    // A typed name goes into the delivery's commands: held to the till's rule.
    if (fields.playerName && !isPlayerName(fields.playerName)) {
        return NextResponse.json(
            { error: "A player name has only the letters a to z, digits and _ . -", code: "chest_player_name_invalid" },
            { status: 400 },
        );
    }

    if (fields.action === "activate") {
        const result = await activateGift(userId, id);
        if (result.ok) return NextResponse.json({ message: "Gift accepted" });
        return result.code === "not_found"
            ? NextResponse.json({ error: "Not found" }, { status: 404 })
            : NextResponse.json({ error: "That gift is no longer waiting", code: "chest_gift_not_pending" }, { status: 409 });
    }

    if (fields.action === "cancel") {
        const result = await cancelGift(userId, id);
        if (result.ok) return NextResponse.json({ message: "Gift taken back", refunded: result.refunded, balance: result.balance });
        if (result.code === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (result.code === "not_pending") {
            return NextResponse.json({ error: "That gift was already accepted", code: "chest_gift_not_pending" }, { status: 409 });
        }
        return NextResponse.json({ error: "The gift could not be taken back" }, { status: 500 });
    }

    const item = await prisma.chestItem.findUnique({ where: { id } });
    if (!item || item.userId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (item.isRedeemed) return NextResponse.json({ error: "Already redeemed" }, { status: 400 });
    if (item.giftState === PENDING) {
        return NextResponse.json({ error: "Accept the gift first", code: "chest_gift_pending" }, { status: 409 });
    }

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

        // A username is unique whatever its case, so the name is matched that
        // way. Two accounts left differing only by case are told apart by the
        // exact spelling, and otherwise neither is guessed at.
        const named = await prisma.user.findMany({
            where: { OR: [{ username: { equals: fields.giftTo, mode: "insensitive" } }, { id: fields.giftTo }] },
            select: { id: true, username: true, receiveGifts: true },
            take: 10,
        });
        const target = named.find((row) => row.id === fields.giftTo || row.username === fields.giftTo)
            ?? (named.length === 1 ? named[0] : null);
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (target.id === userId) {
            return NextResponse.json({ error: "That is your own chest", code: "chest_gift_to_self" }, { status: 400 });
        }
        // Absent reads as the column's default: a member takes gifts until
        // they say otherwise.
        if (target.receiveGifts === false) {
            return NextResponse.json({ error: "That member takes no gifts", code: "chest_recipient_refuses_gifts" }, { status: 409 });
        }

        // Conditional on the row still being this user's and unredeemed, so a
        // gift racing a redeem cannot both win. It lands pending: the
        // recipient accepts it, and until then it is still the sender's to
        // take back.
        const gifted = await prisma.chestItem.updateMany({
            where: { id, userId, isRedeemed: false, giftState: null },
            data: { userId: target.id, giftedToId: target.id, giftedById: userId, giftState: PENDING },
        });
        if (gifted.count === 0) {
            return NextResponse.json({ error: "Already redeemed" }, { status: 400 });
        }
        await doActionAsync("store.gift.sent", {
            senderId: userId,
            recipientId: target.id,
            productName: item.productName,
            quantity: item.quantity,
        }).catch((error: unknown) =>
            log.warn("[store] a gift could not be announced", { error: error instanceof Error ? error.message : String(error) }),
        );

        return NextResponse.json({ message: `Gifted to ${target.username}` });
    }

    const claimed = await claimChestItem(userId, id, { name: fields.playerName ?? null, id: null });
    if (claimed.ok) return NextResponse.json({ message: "Item redeemed" });
    switch (claimed.code) {
        case "needs_player_name":
            // Nothing was recorded and nothing was typed. This used to fall back
            // to the account's username, which is the one name checkout
            // deliberately does not use, so the commands ran for the wrong person.
            return NextResponse.json(
                { error: "Tell us which player to deliver to", code: "chest_needs_player_name" },
                { status: 400 },
            );
        case "not_found":
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        case "not_pending":
            return NextResponse.json({ error: "Accept the gift first", code: "chest_gift_pending" }, { status: 409 });
        default:
            return NextResponse.json({ error: "Already redeemed" }, { status: 400 });
    }
}
