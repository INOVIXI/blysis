/**
 * What a refunded order gives back, as far as the store holds it.
 *
 * A refund or a chargeback used to put the stock back and nothing else: the
 * chest rows stayed claimable, the products stayed owned, the rank stayed
 * held. A buyer who charged a card back kept everything the card paid for.
 *
 * What the store can take back it does, inside the refund's own claim so a
 * second notice takes nothing twice. A delivery command that already ran on a
 * game server cannot be run backwards, and nothing here pretends to: those
 * lines are written on the order, and the order screen tells the operator to
 * take them back in the game.
 */
import { Prisma } from "@prisma/client";
import { prisma, rolesHeldBy, revokeRole, log, type PrismaTransaction } from "@/core/sdk/server";
import { stillOwnedWhere } from "./ownership";

const DAY = 86_400_000;

/** A role the refunded order granted, to be looked at once the refund commits. */
export interface GrantedRole {
    userId: string;
    roleId: string;
}

/**
 * Takes back the order's unclaimed chest rows and the ownership it wrote, and
 * records the lines already delivered. Returns the roles to look at after.
 *
 * An ownership row names the order that last wrote it. Owned outright, this
 * order created it, so it goes. Timed, this order added its days to whatever
 * was left, so only those days come off: removing the row would take the time
 * an earlier order paid for too.
 */
export async function takeBackOrder(
    tx: PrismaTransaction,
    order: { id: string; metadata: unknown },
): Promise<GrantedRole[]> {
    await tx.chestItem.deleteMany({ where: { orderId: order.id, isRedeemed: false } });

    const delivered = await tx.chestItem.findMany({
        where: { orderId: order.id, isRedeemed: true },
        select: { productName: true },
        take: 100,
    });
    if (delivered.length > 0) {
        const metadata = order.metadata && typeof order.metadata === "object" ? (order.metadata as Record<string, unknown>) : {};
        await tx.order.update({
            where: { id: order.id },
            data: {
                metadata: { ...metadata, keptInGame: [...new Set(delivered.map((row) => row.productName))] } as Prisma.InputJsonValue,
            },
        });
    }

    const owned = await tx.ownedProduct.findMany({
        where: { orderId: order.id },
        select: { id: true, userId: true, productId: true, expiresAt: true },
    });
    if (owned.length === 0) return [];

    const products = await tx.product.findMany({
        where: { id: { in: [...new Set(owned.map((row) => row.productId))] } },
        select: { id: true, durationDays: true, grantsRoleId: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    const outright: string[] = [];
    for (const row of owned) {
        const days = byId.get(row.productId)?.durationDays ?? null;
        if (days !== null && days > 0 && row.expiresAt) {
            await tx.ownedProduct.update({
                where: { id: row.id },
                data: { expiresAt: new Date(row.expiresAt.getTime() - days * DAY) },
            });
        } else {
            outright.push(row.id);
        }
    }
    if (outright.length > 0) await tx.ownedProduct.deleteMany({ where: { id: { in: outright } } });

    const roles: GrantedRole[] = [];
    for (const row of owned) {
        const roleId = byId.get(row.productId)?.grantsRoleId;
        if (row.userId && roleId) roles.push({ userId: row.userId, roleId });
    }
    return roles;
}

/**
 * Revokes a rank the refunded order granted, unless something else still
 * holds it there: a rank an administrator gave by hand, or another product
 * the member still owns that grants the same rank.
 *
 * After the refund commits and outside it, the same way settlement grants: a
 * role write is the core's, and an account gone since must not undo a refund.
 */
export async function revokeRefundedRoles(roles: readonly GrantedRole[]): Promise<void> {
    const now = new Date();
    for (const { userId, roleId } of roles) {
        try {
            const held = await rolesHeldBy(userId);
            if (!held.some((role) => role.roleId === roleId && role.source === "store:product")) continue;
            const granting = await prisma.product.findMany({ where: { grantsRoleId: roleId }, select: { id: true } });
            const stillOwned = await prisma.ownedProduct.count({
                where: { ...stillOwnedWhere(userId, now), productId: { in: granting.map((product) => product.id) } },
            });
            if (stillOwned === 0) await revokeRole(userId, roleId);
        } catch (error) {
            log.error("[store] a refunded rank could not be taken back", {
                userId,
                roleId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
