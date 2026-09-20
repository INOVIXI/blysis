import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A shop that has been trading for a while.
 *
 * Products across categories at different prices, some featured, some with a
 * compare-at price, a few limited to a stock count and one deliberately sold
 * out - and orders behind them in every status, spread over months, so the
 * revenue chart, the popular-products ordering and the order filters all have
 * something real to sort. `unitsSold` is written from the paid orders rather
 * than made up, because that is the column the public ranking reads.
 */
const CATEGORIES: [string, string][] = [
    ["Ranks", "Permanent upgrades for your account."],
    ["Crate Keys", "Open a crate, get a drop."],
    ["Cosmetics", "Hats, trails and pets."],
    ["Boosters", "More XP and money for everyone online."],
];

/**
 * A rule to show for each shape the shop can now sell in. Without one of
 * each, the window, the limit and the sale are branches nobody looks at.
 */
const SCHEDULES: Record<string, Record<string, unknown>> = {
    "Weekend Booster Pack": {
        // Friday and Saturday evenings only.
        availableDays: [5, 6],
        availableFromMinute: 18 * 60,
        availableUntilMinute: 23 * 60,
        outsideWindow: "countdown",
    },
    "Legendary Key": {
        // Ten a day, and one per person a day: the two limits together.
        periodStock: 10,
        periodStockWindow: "day",
        perPersonLimit: 1,
        perPersonPeriod: "day",
    },
    "Key Bundle (10)": {
        // A sale that started yesterday and ends in a few days.
        salePrice: 19.99,
        saleFrom: new Date(Date.now() - 86_400_000),
        saleUntil: new Date(Date.now() + 4 * 86_400_000),
    },
    "MVP+": {
        // One to an account, ever: a rank nobody needs twice.
        perPersonLimit: 1,
        perPersonPeriod: "ever",
    },
    "Legend": {
        // A run that has not opened yet, with a countdown to it.
        availableFrom: new Date(Date.now() + 2 * 86_400_000),
        availableUntil: new Date(Date.now() + 9 * 86_400_000),
        outsideWindow: "countdown",
    },
};

/** Products the seed leaves nearly gone, so the urgency badge has a subject. */
const NEARLY_GONE = new Set(["Pet: Baby Dragon"]);

/**
 * A name to a slug.
 *
 * The `+` tiers are the reason this is a named function with a rule of its
 * own: stripping every character that is not a letter or a digit turned
 * "VIP+" into "vip", which the tier below it already answers to, and the seed
 * skips a slug that exists because an existing slug is the operator's
 * product. Two tiers were dropped on every run under a log line that said
 * fifteen.
 */
export function productSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/\+/g, "-plus")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

const PRODUCTS: [string, string, number, number | null][] = [
    ["VIP", "Ranks", 9.99, null],
    ["VIP+", "Ranks", 19.99, 24.99],
    ["MVP", "Ranks", 39.99, null],
    ["MVP+", "Ranks", 74.99, 89.99],
    ["Legend", "Ranks", 129.99, null],
    ["Common Key", "Crate Keys", 1.49, null],
    ["Rare Key", "Crate Keys", 3.99, null],
    ["Legendary Key", "Crate Keys", 9.99, 12.99],
    ["Key Bundle (10)", "Crate Keys", 29.99, 39.9],
    ["Particle Trail", "Cosmetics", 4.99, null],
    ["Pet: Baby Dragon", "Cosmetics", 7.99, null],
    ["Hat Collection", "Cosmetics", 14.99, null],
    ["2x XP for an Hour", "Boosters", 2.99, null],
    ["2x Money for an Hour", "Boosters", 2.99, null],
    ["Weekend Booster Pack", "Boosters", 9.99, 14.99],
];

/**
 * The shipped artwork, handed out in order.
 *
 * A shop is the most picture-shaped screen the product has: the card is a
 * 2:1 image with a price under it, and the product page opens on a 16:9
 * gallery. With the column null every card drew the same grey box, so
 * nothing about the layout could be judged - and the gallery's arrows, which
 * only appear on a product with more than one picture, never appeared at all.
 * A third of them get a second and third view for that reason.
 */
const ART = [
    "/demo/product-01.svg", "/demo/product-02.svg", "/demo/product-03.svg", "/demo/product-04.svg",
    "/demo/product-05.svg", "/demo/product-06.svg", "/demo/product-07.svg", "/demo/product-08.svg",
];

/**
 * How many pictures a seeded product has.
 *
 * A third of them used to get three and the rest got one, which left the
 * gallery - arrows, dots, a counter, a thumbnail strip and the full-size view
 * behind them - drawn on two products out of fifteen. Every product has a
 * gallery now, and the count varies so the strip is exercised at each width:
 * a shop where every product has exactly three pictures tests one layout.
 */
function galleryFor(index: number): string[] {
    const many = 2 + (index % 3); // two, three or four
    return Array.from({ length: many }, (_, at) => ART[(index + at * 3) % ART.length]);
}

const STATUSES = ["COMPLETED", "COMPLETED", "COMPLETED", "PENDING", "PROCESSING", "CANCELLED", "REFUNDED"] as const;

export const seed: ModuleSeed = {
    run: async (ctx) => {
        // The rank a rank-gated product asks for. A demo shop with one is how
        // anybody sees what the badge looks like.
        const vipRole = await ctx.prisma.role.findFirst({
            where: { name: { in: ["vip", "moderator", "admin"] } },
            orderBy: { priority: "desc" },
            select: { id: true },
        });
        const categories = new Map<string, { id: string }>();
        for (const [index, [name, description]] of CATEGORIES.entries()) {
            const slug = name.toLowerCase().replace(/\s+/g, "-");
            categories.set(name, await ctx.create("category", () => ctx.prisma.category.upsert({
                where: { slug },
                update: {},
                create: { name, slug, description, order: index, image: ART[index % ART.length] },
            })));
        }

        const products: { id: string; price: number; name: string }[] = [];
        for (const [index, [name, category, price, comparePrice]] of PRODUCTS.entries()) {
            const slug = productSlug(name);
            const limited = index % 5 === 4;
            // A shop that already sells something keeps what it sells: an
            // existing slug is the operator's product, not this tool's.
            const existing = await ctx.prisma.product.findUnique({ where: { slug }, select: { id: true } });
            if (existing) {
                products.push({ id: existing.id, price, name });
                continue;
            }
            const row = await ctx.create("product", () => ctx.prisma.product.create({
                data: {
                    name,
                    slug,
                    description: ctx.paragraphs(2),
                    shortDesc: ctx.sentence(),
                    price,
                    comparePrice,
                    // Most digital goods are unlimited; a couple are limited,
                    // and one is out of stock on purpose - that is the state
                    // the buy button has to refuse.
                    stock: NEARLY_GONE.has(name)
                        ? 2
                        : limited ? (index === 4 ? 0 : ctx.int(1, 25)) : null,
                    // The first of the gallery is the card's picture, so the
                    // shelf and the page open on the same image.
                    image: galleryFor(index)[0],
                    images: galleryFor(index),
                    isFeatured: index < 3,
                    createdAt: ctx.daysAgo(365),
                    categoryId: categories.get(category)?.id ?? null,
                    // A rank is tied to the account that wears it, so it is
                    // not something to hand to somebody else. Seeded that way
                    // because a product nobody has marked is a switch nobody
                    // can see working: every chest row carried a Gift button
                    // and the demo shop had nothing to refuse.
                    giftable: category !== "Ranks",
                    ...(SCHEDULES[name] ?? {}),
                    // One product for a rank, so the badge and the refusal
                    // are both visible on a seeded shop.
                    ...(name === "Hat Collection" && vipRole ? { roleIds: [vipRole.id] } : {}),
                },
            }));
            products.push({ id: row.id, price, name });
        }

        // A rerun continues the numbering rather than colliding with it:
        // `orderNumber` is unique, so writing DEMO-1000 twice is an error that
        // takes the rest of the seed down with it.
        const alreadyMade = await ctx.prisma.order.count({ where: { orderNumber: { startsWith: "DEMO-" } } });
        const howMany = 8 * ctx.scale;
        const sold = new Map<string, number>();
        for (let i = 0; i < howMany; i++) {
            const status = ctx.pick(STATUSES);
            const lines = ctx.some(products, ctx.int(1, 3));
            const items = lines.map((product) => ({ product, quantity: ctx.int(1, 3) }));
            const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
            const createdAt = ctx.daysAgo(240);

            const order = await ctx.create("order", () => ctx.prisma.order.create({
                data: {
                    orderNumber: `DEMO-${String(1000 + alreadyMade + i)}`,
                    status,
                    subtotal,
                    total: subtotal,
                    currency: "USD",
                    paymentMethod: ctx.pick(["stripe", "paypal", "paytr", "credits"]),
                    // Half of them are the operator's own. Their order tab
                    // pages ten at a time and shows a status filter, and none
                    // of that is visible on an account that has never bought
                    // anything - which is what every seeded install left the
                    // operator looking at.
                    userId: i % 2 === 0 ? ctx.me.id : ctx.pick(ctx.users).id,
                    createdAt,
                },
            }));

            for (const { product, quantity } of items) {
                await ctx.create("orderItem", () => ctx.prisma.orderItem.create({
                    data: {
                        orderId: order.id,
                        productId: product.id,
                        name: product.name,
                        price: product.price,
                        quantity,
                    },
                }));
                if (status === "COMPLETED") {
                    sold.set(product.id, (sold.get(product.id) ?? 0) + quantity);
                }
            }
        }

        // What sells is counted when it sells: the public "popular" ordering
        // reads this column, so it has to match the orders above rather than
        // be invented.
        for (const [productId, units] of sold) {
            await ctx.prisma.product.update({ where: { id: productId }, data: { unitsSold: units } });
        }

        // What is waiting in a chest.
        //
        // A chest holds what was bought and not yet claimed, and nothing had
        // ever written one: the tab was the empty state on every install, so
        // neither the claim button, the gift dialog nor the dialog that asks
        // who an unbought item is for had a subject. The last of those is the
        // reason one row here carries no player name.
        const chestOwners = [ctx.me, ...ctx.some(ctx.users, 3)];
        let chestRows = 0;
        for (const owner of chestOwners) {
            const howManyItems = owner.id === ctx.me.id ? 5 : 2;
            for (let item = 0; item < howManyItems; item++) {
                const product = ctx.pick(products);
                const already = await ctx.prisma.chestItem.findFirst({
                    where: { userId: owner.id, productId: product.id, isRedeemed: false },
                });
                if (already) continue;
                await ctx.create("chestItem", () => ctx.prisma.chestItem.create({
                    data: {
                        userId: owner.id,
                        productId: product.id,
                        productName: product.name,
                        quantity: ctx.int(1, 3),
                        // One row with nobody recorded, per owner: that is an
                        // item an operator put there by hand, and the only
                        // case the claim step asks a question.
                        playerName: item === 0 ? null : owner.username,
                        createdAt: ctx.daysAgo(60),
                    },
                }));
                chestRows += 1;
            }
        }

        // Who already stands on a rung.
        //
        // A paid order writes an ownership at settlement, and the seed's orders
        // never go through a gateway, so a demo site had none at all: the
        // upgrade credit - pay the difference for the next rank up - could not
        // fire anywhere, which made a whole feature invisible to anybody
        // looking at the demo. The operator gets the bottom rung, because the
        // offer they are being shown is the one they are most likely to test.
        const ranksShelf = categories.get("Ranks");
        if (ranksShelf) {
            const rungs = await ctx.prisma.product.findMany({
                where: { categoryId: ranksShelf.id },
                orderBy: { price: "asc" },
                select: { id: true, name: true },
                take: 12,
            });
            const owners = [ctx.me, ...ctx.some(ctx.users, 4)];
            let owned = 0;
            for (const [index, owner] of owners.entries()) {
                // Different people on different rungs, so a table read as one
                // of them shows a different offer from the next.
                const rung = rungs[index % Math.max(1, rungs.length - 1)];
                if (!rung) continue;
                const already = await ctx.prisma.ownedProduct.findFirst({
                    where: { userId: owner.id, productId: rung.id },
                    select: { id: true },
                });
                if (already) continue;
                await ctx.create("ownedProduct", () => ctx.prisma.ownedProduct.create({
                    data: {
                        userId: owner.id,
                        productId: rung.id,
                        // Owned outright: a rank with an end date is a
                        // different demo, and the credit rule already has its
                        // own test for the lapsed case.
                        expiresAt: null,
                        createdAt: ctx.daysAgo(90),
                    },
                }));
                owned += 1;
            }
            ctx.log(`${owned} rank ownerships, so the upgrade credit has somebody to apply to`);
        }

        // The ranks shelf is a ladder, so it is drawn as one.
        //
        // The switch is the shop's, because the category is the shop's row.
        // Whether anything can draw a comparison is somebody else's business:
        // with nothing installed to fill that slot the shelf falls back to its
        // grid, so turning this on is safe on a site with no such module.
        const ranks = categories.get("Ranks");
        if (ranks) {
            await ctx.prisma.category.update({ where: { id: ranks.id }, data: { layout: "table" } });
        }

        ctx.log(`${products.length} products in ${categories.size} categories, ${howMany} orders, ${chestRows} chest items`);
    },
};
