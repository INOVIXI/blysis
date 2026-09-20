import type { ModuleSeed } from "@/core/sdk/seed";
import { generateKey, hashKey, hashMachine, keyHint, sealKey } from "./lib/key";

/**
 * Keys in every state the admin screen has a column for.
 *
 * Minted with the module's own key functions rather than made up, because the
 * row holds a hash, a sealed copy and a hint, and the three agreeing is the
 * whole contract: a key written by hand would look right on the screen and
 * fail the first time somebody checked it.
 *
 * The functions, not `issueKey`. That helper writes through the SDK's own
 * Prisma client, which is a second connection the seed script knows nothing
 * about - and the run hung on it rather than failing, which is the worse of
 * the two ways to be wrong.
 *
 * Active, expired, revoked, and one that has been activated up to its limit -
 * the four rows that make the filters and the activation counter mean
 * anything. A demo where every key is active shows none of it.
 */
const PRODUCTS: { productId: string; productName: string; prefix: string; maxActivations: number; validDays: number | null }[] = [
    { productId: "launcher-pro", productName: "Launcher Pro", prefix: "LNCH", maxActivations: 3, validDays: null },
    { productId: "season-pass", productName: "Season pass", prefix: "SEAS", maxActivations: 1, validDays: 365 },
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        let issued = 0;

        for (const product of PRODUCTS) {
            const known = await ctx.prisma.licenseProduct.findFirst({ where: { productId: product.productId } });
            if (!known) {
                await ctx.create("licenseProduct", () => ctx.prisma.licenseProduct.create({
                    data: {
                        productId: product.productId,
                        keysPerUnit: 1,
                        maxActivations: product.maxActivations,
                        validDays: product.validDays,
                        prefix: product.prefix,
                    },
                }));
            }

            // Four keys per product, and the first is the operator's own. A
            // licence screen is the buyer's screen: the only account that can
            // see what a key looks like revealed, copied and counted against
            // its activations is the account holding one.
            for (let i = 0; i < 4; i++) {
                const owner = i === 0 ? ctx.me : ctx.pick(ctx.users);
                const plain = generateKey(product.prefix);
                const key = await ctx.create("licenseKey", () => ctx.prisma.licenseKey.create({
                    data: {
                        keyHash: hashKey(plain),
                        keySealed: sealKey(plain),
                        keyHint: keyHint(plain),
                        productId: product.productId,
                        productName: product.productName,
                        userId: owner.id,
                        maxActivations: product.maxActivations,
                        expiresAt: product.validDays
                            ? new Date(Date.now() + product.validDays * 86_400_000)
                            : null,
                        createdAt: ctx.daysAgo(120),
                    },
                }));
                issued += 1;

                // One of each product is retired, one is used up and one has
                // lapsed, so the status filter and the activation counter
                // both have something to show.
                if (i === 1) {
                    await ctx.prisma.licenseKey.update({ where: { id: key.id }, data: { status: "revoked", note: "Refunded" } });
                } else if (i === 3) {
                    // The fourth state the screen has a column for, and the
                    // one this seed claimed to write and never did: a key
                    // whose window has closed rather than been taken away.
                    await ctx.prisma.licenseKey.update({
                        where: { id: key.id },
                        data: { expiresAt: ctx.daysAgo(20) },
                    });
                } else if (i === 2) {
                    for (let machine = 0; machine < product.maxActivations; machine++) {
                        await ctx.create("licenseActivation", () => ctx.prisma.licenseActivation.create({
                            data: {
                                licenseKeyId: key.id,
                                // The row stores a hash of the machine, not
                                // the machine. Any stable string stands in
                                // for one here.
                                machineHash: hashMachine(`demo-${product.prefix.toLowerCase()}-${machine}`),
                                label: `Desktop ${machine + 1}`,
                                activatedAt: ctx.daysAgo(40),
                                lastSeenAt: ctx.daysAgo(3),
                            },
                        }));
                    }
                }
            }
        }
        ctx.log(`${PRODUCTS.length} products, ${issued} keys (one of each to ${ctx.me.username})`);
    },
};
