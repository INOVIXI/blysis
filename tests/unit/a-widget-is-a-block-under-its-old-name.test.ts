import { describe, it, expect } from "vitest";
import { blocksOf, sortBlocks } from "@/core/lib/page-blocks";

/**
 * Every widget and homepage section a module declares is also a block, under
 * the name it has always had.
 *
 * A page is arranged from blocks now, but every installed module, first
 * party or not, declares widgets and sections. Rewriting them all before the
 * page could be drawn would break each one nobody rewrote, so the two old
 * kinds are read as blocks: a widget fits the narrow column it has always
 * stood in, a section the wide one, and each keeps its id so an arrangement
 * saved under it still finds it.
 */

const WIDGET = { id: "FeaturedProductWidget", component: "widgets/featured-product-widget", defaultOrder: 0, defaultVisible: true };
const SECTION = { id: "BlogNewsSection", type: "content" as const, component: "components/BlogNewsSection", order: 10 };

describe("a module's blocks", () => {
    it("include each widget, narrow, under its own id", () => {
        expect(blocksOf("store", { widgets: [WIDGET] })).toEqual([{
            id: "store.FeaturedProductWidget",
            module: "store",
            entryId: "FeaturedProductWidget",
            component: "widgets/featured-product-widget",
            widths: ["narrow"],
            defaultOrder: 0,
            defaultVisible: true,
            settings: {},
            replaces: ["FeaturedProductWidget"],
        }]);
    });

    it("include each section, wide or full, shown unless switched off", () => {
        const [block] = blocksOf("blog", { homepageSections: [SECTION] });
        expect(block.id).toBe("blog.BlogNewsSection");
        expect(block.widths).toEqual(["wide", "full"]);
        expect(block.defaultOrder).toBe(10);
        expect(block.defaultVisible).toBe(true);
        expect(block.replaces).toEqual(["BlogNewsSection"]);
    });

    it("are the declared block alone when it replaces a widget the manifest still lists", () => {
        const blocks = blocksOf("store", {
            widgets: [WIDGET],
            blocks: [{ id: "featured-product", component: "blocks/FeaturedProduct", widths: ["narrow", "wide"], defaultOrder: 0, defaultVisible: true, replaces: ["FeaturedProductWidget"] }],
        });
        expect(blocks.map((b) => b.id)).toEqual(["store.featured-product"]);
        expect(blocks[0].replaces).toEqual(["FeaturedProductWidget"]);
    });

    it("are put in their declared order, then by id", () => {
        const blocks = sortBlocks([
            ...blocksOf("b", { widgets: [{ ...WIDGET, id: "Two", defaultOrder: 5 }] }),
            ...blocksOf("a", { widgets: [{ ...WIDGET, id: "One", defaultOrder: 5 }, { ...WIDGET, id: "Zero", defaultOrder: -1 }] }),
        ]);
        expect(blocks.map((b) => b.id)).toEqual(["a.Zero", "a.One", "b.Two"]);
    });
});
