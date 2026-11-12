/**
 * A page the team wrote is titled by its own name in the browser tab.
 *
 * Core titles a module page from the route it declared, and custom pages
 * declare one route for all of them, so every page was "Page | <site>" in the
 * tab and in a search result. The resolver already reads the row to say the
 * page exists; it now says what the page is called too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@/core/sdk/server", () => ({ prisma: { customPage: { findFirst } } }));

const { default: customPageExists } = await import("@/modules/custom-pages/lib/route-exists");

describe("the custom page resolver", () => {
    beforeEach(() => findFirst.mockReset());

    it("names the page it found", async () => {
        findFirst.mockResolvedValue({ id: "p1", title: "Server Rules" });
        expect(await customPageExists({ slug: "rules" })).toEqual({ title: "Server Rules" });
        expect(findFirst.mock.calls[0][0].select).toEqual({ id: true, title: true });
    });

    it("answers no for a page that is not there or not published", async () => {
        findFirst.mockResolvedValue(null);
        expect(await customPageExists({ slug: "nope" })).toBe(false);
        expect(findFirst.mock.calls[0][0].where).toEqual({ OR: [{ slug: "nope" }, { id: "nope" }], isActive: true });
    });

    it("asks nothing for an empty slug", async () => {
        expect(await customPageExists({})).toBe(false);
        expect(findFirst).not.toHaveBeenCalled();
    });
});
