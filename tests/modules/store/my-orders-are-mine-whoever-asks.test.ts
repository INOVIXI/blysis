/**
 * "My orders" lists the caller's own orders, staff included.
 *
 * The profile tab and the admin order screen read one endpoint, and the
 * endpoint answered anyone holding store.orders with every order on the site.
 * The site's owner opening their own profile read thousands of other members'
 * purchases under the heading "My orders". Everyone's orders are now something
 * the admin screen asks for by name, and only staff are given them.
 */
import { describe, it, expect } from "vitest";
import { orderListOwner } from "@/modules/store/lib/order-list-owner";

describe("whose orders a list shows", () => {
    it("shows staff their own orders on their own list", () => {
        expect(orderListOwner({ scope: null, mayServe: true, userId: "staff-1" })).toBe("staff-1");
    });

    it("shows staff every order when the admin screen asks for all of them", () => {
        expect(orderListOwner({ scope: "all", mayServe: true, userId: "staff-1" })).toBeNull();
    });

    it("shows a member their own orders even when they ask for all of them", () => {
        expect(orderListOwner({ scope: "all", mayServe: false, userId: "member-1" })).toBe("member-1");
    });

    it("treats a scope it does not know as the caller's own", () => {
        expect(orderListOwner({ scope: "everyone", mayServe: true, userId: "staff-1" })).toBe("staff-1");
    });
});
