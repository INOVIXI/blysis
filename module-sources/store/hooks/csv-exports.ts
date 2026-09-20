/**
 * Answers `csv.exports`: the tables this shop can hand over.
 *
 * The export screen offered products and orders against an endpoint that only
 * knew about members, so two of its three buttons opened a tab showing a 400.
 * Writing the queries over there would have been the export module reading
 * `Product` and `Order` - the same coupling the accounting integrator avoids
 * by asking `store.orders.collect` instead of reading the table itself.
 *
 * Cells rather than text: the escaping, and the guard that keeps a
 * spreadsheet from running a cell as a command, is done once by the module
 * that writes the file.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const products: CsvExport = {
    id: "products",
    labelKey: "store.adm_exportProducts",
    header: ["id", "name", "slug", "price", "stock", "unitsSold", "isActive", "createdAt"],
    read: async (skip, take) => {
        const rows = await prisma.product.findMany({
            select: {
                id: true, name: true, slug: true, price: true,
                stock: true, unitsSold: true, isActive: true, createdAt: true,
            },
            // Paging without an order is paging over an undefined sequence.
            orderBy: { id: "asc" },
            skip,
            take,
        });
        return rows.map((row) => [
            row.id,
            row.name,
            row.slug,
            // A Prisma Decimal is an object; as a number it is written as a
            // figure rather than quoted as a word.
            Number(row.price),
            row.stock ?? "",
            row.unitsSold,
            row.isActive,
            row.createdAt,
        ]);
    },
};

const orders: CsvExport = {
    id: "orders",
    labelKey: "store.adm_exportOrders",
    header: ["id", "orderNumber", "status", "total", "currency", "buyer", "email", "createdAt"],
    read: async (skip, take) => {
        const rows = await prisma.order.findMany({
            select: {
                id: true, orderNumber: true, status: true, total: true,
                currency: true, createdAt: true,
                user: { select: { username: true, email: true } },
            },
            orderBy: { id: "asc" },
            skip,
            take,
        });
        return rows.map((row) => [
            row.id,
            row.orderNumber,
            row.status,
            Number(row.total),
            row.currency,
            // A shop takes guest orders, and inventing a buyer for one is
            // worse than an empty cell.
            row.user?.username ?? "",
            row.user?.email ?? "",
            row.createdAt,
        ]);
    },
};

const offerShopExports: HookHandlerFor<"csv.exports", "filter"> = async (current) => {
    const already = new Set(current.map((one) => one.id));
    return [...current, ...[products, orders].filter((one) => !already.has(one.id))];
};

export default offerShopExports;
