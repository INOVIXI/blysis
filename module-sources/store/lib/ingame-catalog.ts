/**
 * The shop as a game draws it.
 *
 * Only shelves and products an admin marked for games, and a product only on
 * a shelf that is shown too, so hiding a shelf hides everything on it. The
 * price is the one the site would charge now, sale included; what an upgrade
 * credit or a bulk discount takes off is worked out at purchase, for the
 * member buying, as checkout does.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import { effectivePrice } from "./availability";
import { rulesOf, type ProductRow } from "./availability-server";
import { MAX_GAME_QUANTITY, optionsOf } from "./credit-purchase";

/**
 * A game server as the servers module describes it. Spelled out here: this
 * module does not depend on that one, and the shape is checked against its
 * declaration wherever both are installed.
 */
interface ServerName {
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    isActive: boolean;
    order: number;
}

function fieldType(type: string): InGameField["type"] {
    return type === "number" || type === "select" ? type : "text";
}

export async function inGameCatalog(now: Date = new Date()): Promise<InGameCatalog> {
    const categories = await prisma.category.findMany({
        where: { showInGame: true, isActive: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        take: 200,
    });
    if (categories.length === 0) return { currency: "credits", categories: [] };

    const products = await prisma.product.findMany({
        where: { showInGame: true, isActive: true, categoryId: { in: categories.map((c) => c.id) }, type: { not: "SUBSCRIPTION" } },
        orderBy: [{ name: "asc" }],
        take: 1000,
    });
    const productIds = products.map((p) => p.id);
    const [fields, commands, servers] = await Promise.all([
        prisma.productVariable.findMany({ where: { productId: { in: productIds } }, take: 5000 }),
        prisma.productCommand.findMany({
            where: { productId: { in: productIds } },
            select: { productId: true, serverId: true, target: true },
            take: 10000,
        }),
        applyFiltersAsync("servers.list", [] as ServerName[], {}),
    ]);
    const serverName = new Map((servers ?? []).map((s) => [s.id, s.name]));

    const byCategory = new Map<string, InGameProduct[]>();
    for (const product of products) {
        const places = new Set<string>();
        for (const command of commands) {
            if (command.productId !== product.id || command.target === "player") continue;
            const name = command.serverId ? serverName.get(command.serverId) : undefined;
            if (name) places.add(name);
        }
        const entry: InGameProduct = {
            id: product.id,
            title: product.gameTitle || product.name,
            description: product.gameDescription ?? product.shortDesc ?? "",
            icon: product.gameIcon,
            price: effectivePrice(rulesOf(product as unknown as ProductRow), now).price,
            giftable: product.giftable,
            maxQuantity: Math.max(1, Math.min(MAX_GAME_QUANTITY, product.perPersonLimit ?? MAX_GAME_QUANTITY)),
            stock: product.stock,
            servers: [...places].sort(),
            fields: fields
                .filter((f) => f.productId === product.id)
                .map((f) => ({
                    name: f.name,
                    label: f.label,
                    type: fieldType(f.type),
                    required: f.required,
                    placeholder: f.placeholder,
                    options: f.type === "select" ? optionsOf(f.options) : [],
                })),
        };
        const list = byCategory.get(product.categoryId as string);
        if (list) list.push(entry);
        else byCategory.set(product.categoryId as string, [entry]);
    }

    const shown = new Set(categories.map((c) => c.id));
    return {
        currency: "credits",
        categories: categories.map((category) => ({
            id: category.id,
            // A parent that is not shown in game leaves its child at the top.
            parentId: category.parentId && shown.has(category.parentId) ? category.parentId : null,
            title: category.gameTitle || category.name,
            description: category.gameDescription ?? category.description ?? "",
            icon: category.gameIcon,
            order: category.order,
            products: byCategory.get(category.id) ?? [],
        })),
    };
}
