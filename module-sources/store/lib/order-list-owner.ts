/**
 * Whose orders a list shows.
 *
 * The member's "My orders" tab and the admin order screen read the same
 * endpoint. The endpoint used to answer anyone holding store.orders with every
 * order on the site, so the site's owner opening "My orders" on their profile
 * read every member's purchases there. A list is now the caller's own unless
 * they ask for everyone's with `scope=all` and hold the permission to see
 * them; asking without it still answers with their own, so a screen that asks
 * wrongly shows less, never more.
 */
export interface OrderListRequest {
    scope: string | null;
    mayServe: boolean;
    userId: string;
}

/** The owner to filter on, or null for every order. */
export function orderListOwner({ scope, mayServe, userId }: OrderListRequest): string | null {
    return scope === "all" && mayServe ? null : userId;
}
