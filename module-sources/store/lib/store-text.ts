/**
 * The shop's words in the shopper's language.
 *
 * A product's name, summary and description, a shelf's name and description,
 * a credit package's and a campaign's name keep the text the operator typed in
 * their own columns, the original, which search, sorting, exports, the
 * in-game catalogue and every order snapshot go on reading. A translation is
 * a row in core's translation table, written by the editor beside the record
 * and read here, a page at a time, for whoever is reading. A shopper whose
 * language has none reads the original.
 *
 * The limits are the columns' own, so a translation can be no longer than
 * the text it translates could be.
 */
import { prisma, translateContent } from "@/core/sdk/server";

export const PRODUCT_TEXT = { owner: "store", entity: "product" };
export const CATEGORY_TEXT = { owner: "store", entity: "category" };
export const CREDIT_PACKAGE_TEXT = { owner: "store", entity: "credit-package" };
export const CAMPAIGN_TEXT = { owner: "store", entity: "campaign" };

export const PRODUCT_FIELDS = { name: 200, shortDesc: 500, description: 100_000 };
export const CATEGORY_FIELDS = { name: 100, description: 500 };
export const CREDIT_PACKAGE_FIELDS = { name: 100 };
export const CAMPAIGN_FIELDS = { name: 100 };

interface Named {
    id: string;
    name: string;
}

/** Shelves, and the shelves inside them, in `locale`: one query for all of them. */
export async function categoriesIn<T extends Named & { description?: string | null; children?: (Named & { description?: string | null })[] }>(
    rows: T[],
    locale: string,
): Promise<T[]> {
    const nested = rows.flatMap((row) => row.children ?? []);
    const all = await translateContent(prisma, CATEGORY_TEXT, [...rows, ...nested], ["name", "description"], locale);
    const byId = new Map(all.map((row) => [row.id, row]));
    return rows.map((row) => ({
        ...(byId.get(row.id) as T),
        ...(row.children ? { children: row.children.map((child) => byId.get(child.id) ?? child) } : {}),
    }));
}

/**
 * Products in `locale`, with the shelf each sits on: one query for the
 * products and one for their shelves, whatever the length of the page.
 */
export async function productsIn<T extends Named & { category?: Named | null }>(rows: T[], locale: string): Promise<T[]> {
    const products = await translateContent(prisma, PRODUCT_TEXT, rows, ["name", "shortDesc", "description"] as (keyof T & string)[], locale);
    const shelves = [...new Map(
        products.flatMap((row) => (row.category ? [[row.category.id, row.category] as const] : [])),
    ).values()];
    if (shelves.length === 0) return products;
    const named = new Map((await translateContent(prisma, CATEGORY_TEXT, shelves, ["name"], locale)).map((row) => [row.id, row]));
    return products.map((row) => (row.category ? { ...row, category: named.get(row.category.id) ?? row.category } : row));
}

/** The reader's language an API route was asked in, or none for the originals. */
export function localeOf(request: Request): string {
    return new URL(request.url).searchParams.get("locale") ?? "";
}
