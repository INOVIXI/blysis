/**
 * Asking what tax a sale carries.
 *
 * Every place the store prices a sale asks here - the checkout, in both its
 * credits and its gateway halves, and a purchase a game server makes - so a
 * tax module installed tomorrow changes all of them at once, and a shop with
 * none keeps charging its own two settings. The rules for reading an answer
 * are in `tax.ts`.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { moduleSettings } from "@/core/sdk/server";
import { checkedAnswer, storeTaxAnswer } from "./tax";

export async function resolveTax(context: StoreTaxContext): Promise<StoreTaxAnswer> {
    const settings = await moduleSettings<{ taxRate: number; taxIncluded: boolean }>("store");
    const own = storeTaxAnswer(settings, context.billing?.country ?? null);
    const answered = await applyFiltersAsync("store.tax", own, context);
    return checkedAnswer(answered, own);
}

/** A request's headers as a listener reads them: one by name, or null. */
export function headerReader(headers: { get(name: string): string | null }): (name: string) => string | null {
    return (name) => headers.get(name);
}

/** For a sale with no request behind it. */
export const NO_HEADERS = (): string | null => null;
