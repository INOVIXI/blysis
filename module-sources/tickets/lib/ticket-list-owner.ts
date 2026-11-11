/**
 * Whose tickets a list shows.
 *
 * The member's own page and the support queue read the same endpoint. The
 * endpoint used to answer a staff caller with every ticket on the site, so a
 * moderator opening "My tickets" read every member's tickets there. A list is
 * now the caller's own unless they ask for everyone's with `scope=all` and
 * hold the permission to see them; asking without it still answers with their
 * own, so a screen that asks wrongly shows less, never more.
 */
export interface TicketListRequest {
    scope: string | null;
    mayManage: boolean;
    userId: string;
}

/** The owner to filter on, or null for every ticket. */
export function ticketListOwner({ scope, mayManage, userId }: TicketListRequest): string | null {
    return scope === "all" && mayManage ? null : userId;
}
