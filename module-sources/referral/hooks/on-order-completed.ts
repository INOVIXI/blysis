/**
 * Paying the referrer when the person they referred first pays for something.
 *
 * Applying a code only records the referral. Paying at that moment left
 * nothing between a reward and a batch of accounts made for it, so the reward
 * waits for money: an order the referred member paid for, with a total above
 * zero, settled by anything but the wallet. An order paid with credits is no
 * proof of spending, for the reason the credits module gives for cashback.
 *
 * The claim is a conditional update on the status, inside the transaction that
 * pays. Two announcements of the same order, or of two orders at once, meet at
 * that row and exactly one wins. If the credits cannot be paid the transaction
 * rolls back, the referral stays pending and the next paid order tries again.
 * Guarded by tests/modules/referral/a-referral-pays-on-the-first-paid-order.test.ts.
 */
import { applyFiltersAsync, type HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const WALLET = "credits";

const onOrderCompleted: HookHandlerFor<"store.order.completed", "action"> = async (order) => {
    if (!order.userId) return;

    const method = (order.paymentMethod ?? "").trim().toLowerCase();
    if (method === "" || method === WALLET) return;
    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) return;

    const referredId = order.userId;
    await prisma.$transaction(async (tx) => {
        const referral = await tx.referral.findFirst({
            where: { referredId, status: "pending", referrerId: { not: null } },
            select: { id: true, referrerId: true, rewardAmount: true },
        });
        if (!referral?.referrerId) return;

        const claimed = await tx.referral.updateMany({
            where: { id: referral.id, status: "pending" },
            data: { status: "rewarded" },
        });
        if (claimed.count === 0) return;

        const amount = Number(referral.rewardAmount);
        if (amount <= 0) return;
        const paid = await applyFiltersAsync("credit.change", { applied: false }, {
            tx,
            userId: referral.referrerId,
            amount,
            type: "referral_reward",
            description: "Referral reward: the person you invited made their first purchase",
        });
        if (!paid.applied) throw new Error("the referral reward could not be paid");
    });
};

export default onOrderCompleted;
