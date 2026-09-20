import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A wallet with a history behind it.
 *
 * The balance is a column on the account and the history is a table, and
 * nothing had ever written either: the credits tab drew a zero, an empty
 * ledger, and a Send form that refuses every amount because the balance
 * cannot cover it. None of the three panels on that screen could be judged.
 *
 * The rows are written in order and the balance is the sum of them rather
 * than a number picked to look plausible - a ledger that does not add up to
 * the figure above it is the one bug this screen exists to make visible.
 *
 * Every kind the catalogue names, because the icon and the sign are chosen
 * per kind: bought, spent, sent, received, cashback, a referral reward, a
 * wheel prize and an administrator's adjustment.
 */
const ENTRIES: [string, number, string][] = [
    ["credit_purchase", 250, "Bought the 250 pack"],
    ["purchase", -49.99, "MVP rank"],
    ["cashback", 5, "Cashback on order DEMO-1004"],
    ["transfer_out", -25, "Sent to a friend"],
    ["wheel_prize", 15, "Won on the wheel"],
    ["referral_reward", 10, "Somebody used your link"],
    ["transfer_in", 40, "Received from a friend"],
    ["purchase", -9.99, "Legendary key"],
    ["admin_grant", 100, "Thanks for the bug report"],
    ["gift_redeem", 20, "Gift code"],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        // The operator first, because the credits tab is a screen about your
        // own money; the demo accounts after, so a transfer has somebody to
        // come from and the admin balance column is not one number and a
        // column of zeroes.
        const holders = [ctx.me, ...ctx.some(ctx.users, 5)];
        let written = 0;

        for (const holder of holders) {
            const already = await ctx.prisma.creditTransaction.count({ where: { userId: holder.id } });
            if (already > 0) continue;

            // The operator gets the whole catalogue; everybody else gets a
            // handful, so the balances differ and the admin list sorts.
            const entries = holder.id === ctx.me.id ? ENTRIES : ctx.some(ENTRIES, 4);
            let balance = 0;

            for (const [type, amount, description] of entries) {
                balance += amount;
                await ctx.create("creditTransaction", () => ctx.prisma.creditTransaction.create({
                    data: {
                        userId: holder.id,
                        amount,
                        type,
                        description,
                        createdAt: ctx.daysAgo(180),
                    },
                }));
                written += 1;
            }

            await ctx.prisma.user.update({
                where: { id: holder.id },
                // Rounded the way the column is: two decimal places, or the
                // sum of the rows and the figure above them disagree in the
                // last cent.
                data: { creditBalance: Math.round(balance * 100) / 100 },
            });
        }

        ctx.log(`${written} ledger rows across ${holders.length} wallets`);
    },
};
