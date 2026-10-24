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

    it("have their component file checked like any other", () => {
        const parsed = parse([NEWS]);
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(collectManifestFileRefs(parsed.data)).toContain("blocks/NewsBlock");
    });
});
