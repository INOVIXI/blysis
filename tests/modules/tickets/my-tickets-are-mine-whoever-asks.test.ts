/**
 * "My tickets" lists the caller's own tickets, staff included.
 *
 * The member's page and the support queue read one endpoint, and the endpoint
 * answered anyone holding tickets.manage with every ticket on the site. A
 * moderator, or the site's owner, opening their own list read every member's
 * tickets under the heading "My tickets". Everyone's tickets are now something
 * the queue asks for by name, and only staff are given them.
 */
import { describe, it, expect } from "vitest";
import { ticketListOwner } from "@/modules/tickets/lib/ticket-list-owner";

describe("whose tickets a list shows", () => {
    it("shows staff their own tickets on their own list", () => {
        expect(ticketListOwner({ scope: null, mayManage: true, userId: "staff-1" })).toBe("staff-1");
    });

    it("shows staff every ticket when the queue asks for all of them", () => {
        expect(ticketListOwner({ scope: "all", mayManage: true, userId: "staff-1" })).toBeNull();
    });

    it("shows a member their own tickets even when they ask for all of them", () => {
        expect(ticketListOwner({ scope: "all", mayManage: false, userId: "member-1" })).toBe("member-1");
    });

    it("treats a scope it does not know as the caller's own", () => {
        expect(ticketListOwner({ scope: "everyone", mayManage: true, userId: "staff-1" })).toBe("staff-1");
    });
});
