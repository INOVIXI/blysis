import { z } from "zod";

// ==================== STORE SCHEMAS ====================

export const productSchema = z.object({
    name: z.string().min(1, "Name is required").max(200),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    shortDesc: z.string().max(500).optional(),
    price: z.number().min(0, "Price must be positive"),
    comparePrice: z.number().min(0).optional().nullable(),
    image: z.string().url().optional().nullable(),
    images: z.array(z.string().url()).optional(),
    stock: z.number().int().min(0).optional().nullable(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    type: z.enum(["DIGITAL", "PHYSICAL", "GAME_ITEM", "SUBSCRIPTION"]).optional(),
    categoryId: z.string().optional().nullable(),
    deliveryData: z.any().optional(),
    subscriptionInterval: z.enum(["month", "year"]).optional().nullable(),
    subscriptionIntervalCount: z.number().int().min(1).max(12).optional().nullable(),

    // When it is for sale. The dates arrive as the operator typed them -
    // "2026-10-20T18:00" - and the server turns them into instants on the
    // site's clock, because a browser would use its own and an operator on
    // holiday would schedule a sale three hours out.
    availableFrom: z.string().max(32).optional().nullable(),
    availableUntil: z.string().max(32).optional().nullable(),
    availableDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    availableFromMinute: z.number().int().min(0).max(1439).optional().nullable(),
    availableUntilMinute: z.number().int().min(0).max(1439).optional().nullable(),
    outsideWindow: z.enum(["countdown", "hidden"]).optional(),
    /** The form writes one role, or "" for everyone; the column holds a list. */
    roleId: z.string().max(64).optional().nullable(),
    roleIds: z.array(z.string().max(64)).max(20).optional(),
    perPersonLimit: z.number().int().min(1).max(100_000).optional().nullable(),
    perPersonPeriod: z.enum(["ever", "day", "week", "month"]).optional(),
    periodStock: z.number().int().min(1).max(1_000_000).optional().nullable(),
    periodStockWindow: z.enum(["day", "week", "month"]).optional(),
    /**
     * How long a purchase lasts, in days. Null is owned outright.
     *
     * Capped at ten years: the field is a number input and a slip of the hand
     * on a "days" box is how somebody sells a lifetime by accident.
     */
    durationDays: z.number().int().min(1).max(3650).optional().nullable(),
    /** The role a purchase grants. A different question from `roleId`. */
    grantsRoleId: z.string().max(64).optional().nullable(),
    /** Products the buyer must already own. Empty asks for nothing. */
    requiresProductIds: z.array(z.string().max(64)).max(20).optional(),
    /** Own any one of the list rather than all of it. */
    requiresAny: z.boolean().optional(),
    salePrice: z.number().min(0).optional().nullable(),
    saleFrom: z.string().max(32).optional().nullable(),
    saleUntil: z.string().max(32).optional().nullable(),
});

export const categorySchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    /** Own any one of these products to see this shelf. Empty shows it to all. */
    visibleAfterProductIds: z.array(z.string().max(64)).max(20).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().max(500).optional(),
    image: z.string().url().optional().nullable(),
    parentId: z.string().optional().nullable(),
    order: z.number().int().optional(),
    isActive: z.boolean().optional(),
    /** How the shelf is drawn. Anything else is a shape nothing can render. */
    layout: z.enum(["grid", "table"]).optional(),
});

export const manualOrderSchema = z.object({
    userId: z.string().min(1).max(64),
    currency: z.string().length(3),
    notes: z.string().max(500).optional(),
    /** Whether it granted what it names, or is only a record of a sale. */
    markPaid: z.boolean().default(false),
    lines: z.array(z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(1000),
        /** Zero is allowed: a replacement is worth nothing and still counts. */
        unitAmount: z.number().min(0),
    })).min(1).max(50),
});

/** A copy's only choice is what it is called. Everything else is the original's. */
export const copyProductSchema = z.object({
    name: z.string().min(1).max(200).optional(),
});

/** A package of credits. The bonus is what the buyer receives, never what they pay. */
export const creditPackageSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    credits: z.number().int().min(1).max(10_000_000),
    bonusCredits: z.number().int().min(0).max(10_000_000).default(0),
    price: z.number().min(0.01).max(1_000_000),
    isActive: z.boolean().default(true),
    order: z.number().int().min(0).max(9999).default(0),
});

export const campaignSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    isActive: z.boolean().optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    fromMinute: z.number().int().min(0).max(1439).optional().nullable(),
    untilMinute: z.number().int().min(0).max(1439).optional().nullable(),
    /**
     * What is in it. A price of zero is allowed - an operator can mean free -
     * but a negative one is not, and the form never sends a row whose price
     * box was left empty.
     */
    entries: z.array(z.object({
        productId: z.string().min(1).max(64),
        price: z.number().min(0),
        stock: z.number().int().min(1).max(1_000_000).optional().nullable(),
    })).max(200).optional(),
});

export const couponSchema = z.object({
    code: z.string().min(3).max(50).toUpperCase(),
    description: z.string().optional(),
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.number().min(0),
    minPurchase: z.number().min(0).optional().nullable(),
    maxDiscount: z.number().min(0).optional().nullable(),
    usageLimit: z.number().int().min(1).optional().nullable(),
    startsAt: z.string().datetime().optional().nullable(),
    expiresAt: z.string().datetime().optional().nullable(),
    /**
     * Where the offer runs. Empty is every product, which is what every
     * coupon written before there was a way to say otherwise meant. Capped
     * because this arrives from a form and lands in an array column.
     */
    productIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    categoryIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    isActive: z.boolean().optional(),
});


// ==================== THE REST OF THE STORE'S WRITES ====================
//
// These endpoints had no schema at all. Between them they wrote to five
// tables straight from an untyped body: percentages and quantities that reach
// `Int` columns, a coupon code and a gift code that reach `.toUpperCase()`
// (a throw on anything but a string), a player name that reaches an RCON
// command, and a username that reaches a Prisma `where` clause, where an
// object is a filter operator rather than a name.

/** A percentage, as the store's Int columns store one. */
const percent = z.number().int().min(0).max(100);

export const bulkDiscountUpdateSchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    minQuantity: z.number().int().min(1).max(1_000_000).optional(),
    discountPercent: percent.optional(),
    productIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    categoryIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    isActive: z.boolean().optional(),
});

/**
 * Redeeming a chest item, or handing it to somebody else. `giftTo` is matched
 * against both `username` and `id`, and `playerName` is interpolated into the
 * commands the delivery runs, so both are bounded to what those can mean.
 */
export const chestRedeemSchema = z.object({
    giftTo: z.string().trim().max(64).optional().nullable(),
    playerName: z.string().trim().max(64).optional().nullable(),
});

/** The community goal banner: a target, a title, and when it ends. */
export const communityGoalSchema = z.object({
    target: z.number().min(0).max(1_000_000_000).optional(),
    title: z.string().max(200).optional(),
    endDate: z.string().max(64).optional().nullable(),
});

/** Checking a coupon at the basket. */
/**
 * Only the code. What the basket is worth used to be sent with it and
 * believed; the endpoint reads the basket itself now, because a browser
 * cannot be asked whether a minimum purchase was met.
 */
export const couponValidateSchema = z.object({
    code: z.string().trim().min(1, "Code required").max(50),
});

export const creatorCodeCreateSchema = z.object({
    code: z.string().trim().min(1, "Code and creator required").max(50),
    creatorId: z.string().trim().min(1, "Code and creator required").max(64),
    discountPercent: percent.optional(),
    commissionPercent: percent.optional(),
    /** Where the code works. Empty is every product. */
    productIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    categoryIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    /**
     * The form has always drawn this switch and the create never read it, so
     * a code written switched off arrived switched on.
     */
    isActive: z.boolean().optional(),
});

export const creatorCodeUpdateSchema = z.object({
    code: z.string().trim().min(1).max(50).optional(),
    creatorId: z.string().max(64).optional().nullable(),
    discountPercent: percent.optional(),
    commissionPercent: percent.optional(),
    productIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    categoryIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    isActive: z.boolean().optional(),
});

export const giftCodeCreateSchema = z.object({
    value: z.number().positive("Value must be positive").max(1_000_000),
    description: z.string().max(500).optional().nullable(),
    count: z.number().int().min(1).max(100).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional().nullable(),
});

export const giftCodeRedeemSchema = z.object({
    code: z.string().trim().min(1, "Code is required").max(64),
});

export const productCommandSchema = z.object({
    productId: z.string().trim().min(1, "productId and command required").max(64),
    command: z.string().trim().min(1, "productId and command required").max(1_000),
    serverId: z.string().max(64).optional().nullable(),
    order: z.number().int().min(0).max(10_000).optional(),
});

export const productVariableSchema = z.object({
    productId: z.string().trim().min(1, "productId, name, label required").max(64),
    name: z.string().trim().min(1, "productId, name, label required").max(64),
    label: z.string().trim().min(1, "productId, name, label required").max(200),
    type: z.string().max(32).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().max(200).optional().nullable(),
    options: z.string().max(2_000).optional().nullable(),
});

// Type exports
export type ProductInput = z.infer<typeof productSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type CouponInput = z.infer<typeof couponSchema>;
