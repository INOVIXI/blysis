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
    ["Crate keys", "Open a crate, get a drop."],
    ["Cosmetics", "Hats, trails and pets."],
    ["Boosters", "More XP and money for everyone online."],
];

/**
 * A rule to show for each shape the shop can now sell in. Without one of
 * each, the window, the limit and the sale are branches nobody looks at.
 */
const SCHEDULES: Record<string, Record<string, unknown>> = {
    "Weekend booster pack": {
        // Friday and Saturday evenings only.
        availableDays: [5, 6],
        availableFromMinute: 18 * 60,
        availableUntilMinute: 23 * 60,
        outsideWindow: "countdown",
    },
    "Legendary key": {
        // Ten a day, and one per person a day: the two limits together.
        periodStock: 10,
        periodStockWindow: "day",
        perPersonLimit: 1,
        perPersonPeriod: "day",
    },
    "Key bundle (10)": {
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
const NEARLY_GONE = new Set(["Pet: baby dragon"]);

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
    ["Common key", "Crate keys", 1.49, null],
    ["Rare key", "Crate keys", 3.99, null],
    ["Legendary key", "Crate keys", 9.99, 12.99],
    ["Key bundle (10)", "Crate keys", 29.99, 39.9],
    ["Particle trail", "Cosmetics", 4.99, null],
    ["Pet: baby dragon", "Cosmetics", 7.99, null],
    ["Hat collection", "Cosmetics", 14.99, null],
    ["2x XP for an hour", "Boosters", 2.99, null],
    ["2x money for an hour", "Boosters", 2.99, null],
    ["Weekend booster pack", "Boosters", 9.99, 14.99],
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
                    image: ART[index % ART.length],
                    images: index % 3 === 0
                        ? [ART[index % ART.length], ART[(index + 3) % ART.length], ART[(index + 5) % ART.length]]
                        : [],
                    isFeatured: index < 3,
                    createdAt: ctx.daysAgo(365),
                    categoryId: categories.get(category)?.id ?? null,
                    ...(SCHEDULES[name] ?? {}),
                    // One product for a rank, so the badge and the refusal
                    // are both visible on a seeded shop.
                    ...(name === "Hat collection" && vipRole ? { roleIds: [vipRole.id] } : {}),
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
                    userId: ctx.pick(ctx.users).id,
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

        ctx.log(`${products.length} products in ${categories.size} categories, ${howMany} orders`);
    },
};
