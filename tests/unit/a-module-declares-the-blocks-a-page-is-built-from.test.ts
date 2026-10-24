import { describe, it, expect } from "vitest";
import { moduleManifestSchema, collectManifestFileRefs } from "@/core/lib/module-manifest-schema";

/**
 * A module says which blocks it gives a page: what each is called, the file
 * that draws it, the widths it can be placed in and the settings it takes.
 *
 * A widget could only ever stand in the homepage's sidebar and a section only
 * in its main column, because core decided where each kind went. A block says
 * where it fits instead, so a theme or an operator can put it anywhere it
 * does, and the arrangement stops being core's to decide.
 */

const BASE = { id: "sample", name: "Sample", description: "A sample module.", version: "1.0.0", coreVersion: "^5.23.0" };

const NEWS = {
    id: "news",
    label: "News",
    labelKey: "blocks_sample_news",
    component: "blocks/NewsBlock",
    widths: ["wide", "full", "narrow"],
    defaultOrder: 10,
    defaultVisible: true,
    settings: {
        variant: { type: "select", default: "grid", options: [{ value: "grid", label: "Grid", labelKey: "blocks_sample_news_grid" }] },
        count: { type: "number", default: 4, min: 1, max: 12 },
    },
    replaces: ["NewsSection"],
};

function parse(blocks: unknown) {
    return moduleManifestSchema.safeParse({ ...BASE, blocks });
}

describe("a module's blocks", () => {
    it("are declared with their widths and settings", () => {
        const parsed = parse([NEWS]);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(parsed.data?.blocks?.[0].widths).toEqual(["wide", "full", "narrow"]);
        expect(parsed.data?.blocks?.[0].replaces).toEqual(["NewsSection"]);
    });

    it("fit somewhere", () => {
        expect(parse([{ ...NEWS, widths: [] }]).success).toBe(false);
    });

    it("fit only widths a page has", () => {
        expect(parse([{ ...NEWS, widths: ["huge"] }]).success).toBe(false);
    });

    it("are at most fifty, as widgets are", () => {
        const many = Array.from({ length: 51 }, (_, i) => ({ ...NEWS, id: `news${i}` }));
        expect(parse(many).success).toBe(false);
    });

    it("each have a name no other block of the module has", () => {
        // A widget and a section are blocks under their own ids, so two of
        // them sharing an id are one block that draws whichever came last.
        const widget = { id: "NewsSection", label: "News", component: "widgets/News", defaultOrder: 1, defaultVisible: true };
        const section = { id: "NewsSection", type: "content", component: "sections/News", order: 1 };
        expect(parse([NEWS, NEWS]).success).toBe(false);
        expect(moduleManifestSchema.safeParse({ ...BASE, widgets: [widget], homepageSections: [section] }).success).toBe(false);
        expect(moduleManifestSchema.safeParse({ ...BASE, blocks: [{ ...NEWS, id: "Other", replaces: [] }], widgets: [{ ...widget, id: "Other" }] }).success).toBe(false);
    });

    it("never sit under core's name", () => {
        // Core's own blocks are `core.<id>`; a module called `core` would
        // give the page two blocks under one name.
        expect(moduleManifestSchema.safeParse({ ...BASE, id: "core", blocks: [NEWS] }).success).toBe(false);
    });

    it("may share a name with the widget or section they replace", () => {
        const section = { id: "News", type: "content", component: "sections/News", order: 1 };
        const parsed = moduleManifestSchema.safeParse({ ...BASE, blocks: [{ ...NEWS, id: "News", replaces: ["News"] }], homepageSections: [section] });
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("have their component file checked like any other", () => {
        const parsed = parse([NEWS]);
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(collectManifestFileRefs(parsed.data)).toContain("blocks/NewsBlock");
    });
});

describe("a module's own pages", () => {
    const POST = {
        id: "post",
        blocks: [{ id: "article", widths: ["wide", "full"] }, { id: "related", widths: ["narrow"] }],
        layout: { rows: [{ split: "2-1", cells: [[{ key: "a", block: "sample.article" }], [{ key: "r", block: "sample.related" }]] }] },
    };
    const pages = (list: unknown) => moduleManifestSchema.safeParse({ ...BASE, pages: list });

    it("are declared with their blocks and how they stand under a theme with no word for them", () => {
        const parsed = pages([POST]);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("arrange only blocks they declare, under the module's own id", () => {
        const naming = (block: string) => pages([{ ...POST, layout: { rows: [{ split: "1", cells: [[{ key: "x", block }]] }] } }]);
        expect(naming("sample.nope").success).toBe(false);
        expect(naming("other.article").success).toBe(false);
        expect(pages([{ ...POST, layout: { ...POST.layout, hidden: ["sample.nope"] } }]).success).toBe(false);
    });

    it("each have a name of their own, and so does each of their blocks", () => {
        expect(pages([POST, POST]).success).toBe(false);
        expect(pages([{ ...POST, blocks: [...POST.blocks, POST.blocks[0]] }]).success).toBe(false);
    });

    it("are built from at least one block", () => {
        expect(pages([{ ...POST, blocks: [], layout: { rows: [] } }]).success).toBe(false);
    });
});
