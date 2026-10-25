import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { searchDocument, searchMatches, searchRank } from "@/core/lib/search-text";

/**
 * Core used to carry `BlogArticle`, `ForumTopic`, `HelpArticle` and `Product`
 * in a hardcoded array in scripts/ensure-search-indexes.ts - four module
 * tables named in core, and an error line per uninstalled module on every
 * boot. The module that owns the table declares the index now, and these
 * cases are what keeps that safe.
 */

const base = {
    id: "demo",
    name: "Demo",
    description: "A demo module",
    version: "1.0.0",
    coreVersion: "^1.0.0",
};

const withIndexes = (indexes: unknown) => ({
    ...base,
    searchProviders: [
        { id: "demo-search", label: "Demo", handler: "search/handler.ts", indexes },
    ],
});

describe("searchProviders[].indexes", () => {
    it("accepts plain identifiers", () => {
        const r = moduleManifestSchema.safeParse(
            withIndexes([{ table: "DemoThing", columns: ["title", "body"] }]),
        );
        expect(r.success).toBe(true);
    });

    it("is optional", () => {
        const r = moduleManifestSchema.safeParse(withIndexes(undefined));
        expect(r.success).toBe(true);
    });

    // The identifiers are interpolated into DDL, so the schema is the only
    // thing between a manifest and arbitrary SQL.
    it("rejects anything that is not a plain SQL identifier", () => {
        const bad = [
            'Demo"; DROP TABLE "User',
            "Demo Thing",
            "demo-thing",
            "1Demo",
            "",
        ];
        for (const table of bad) {
            expect(
                moduleManifestSchema.safeParse(withIndexes([{ table, columns: ["title"] }])).success,
                `table: ${JSON.stringify(table)}`,
            ).toBe(false);
        }
        for (const column of bad) {
            expect(
                moduleManifestSchema.safeParse(withIndexes([{ table: "Demo", columns: [column] }])).success,
                `column: ${JSON.stringify(column)}`,
            ).toBe(false);
        }
    });

    it("requires at least one column", () => {
        const r = moduleManifestSchema.safeParse(withIndexes([{ table: "Demo", columns: [] }]));
        expect(r.success).toBe(false);
    });
});

describe("the document a table is searched as", () => {
    it("indexes the columns as one English document", () => {
        expect(searchDocument(["title", "excerpt", "content"])).toBe(
            `to_tsvector('english', translate(coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''), 'ıİ', 'iI'))`,
        );
    });

    it("handles a single column without a separator", () => {
        expect(searchDocument(["title"])).toBe(`to_tsvector('english', translate(coalesce("title", ''), 'ıİ', 'iI'))`);
    });
});

/*
 * A Turkish reader typing "altin" or "ALTIN" found nothing called "Altın":
 * the dotless ı is a letter of its own to Postgres, and upper-case I folds to
 * the dotted i. Both the document and the query fold ı and İ before Postgres
 * reads them. A handler that matched with an expression of its own would
 * also stop using the index the moment the two drifted, so the match a module
 * writes is the one the index was built from.
 */
describe("a search a module runs", () => {
    it("is matched against the very expression the index was built from", () => {
        const match = searchMatches(["title", "content"], "altin");
        expect(match.sql).toBe(`${searchDocument(["title", "content"])} @@ plainto_tsquery('english', translate(?, 'ıİ', 'iI'))`);
        expect(match.values).toEqual(["altin"]);
    });

    it("is ranked by the same document and query", () => {
        const rank = searchRank(["title"], "ALTIN");
        expect(rank.sql).toBe(`ts_rank(${searchDocument(["title"])}, plainto_tsquery('english', translate(?, 'ıİ', 'iI')))`);
        expect(rank.values).toEqual(["ALTIN"]);
    });

    it("takes only plain column names", () => {
        expect(() => searchMatches(['title" || pg_sleep(1) || "'], "x")).toThrow();
    });
});

describe("the catalog still declares every index core used to hardcode", () => {
    // Dropping one of these would silently remove a full-text index from a
    // shipped module, and nothing else would notice.
    const expected: Record<string, string> = {
        blog: "BlogArticle",
        forum: "ForumTopic",
        "help-center": "HelpArticle",
        store: "Product",
    };

    for (const [moduleId, table] of Object.entries(expected)) {
        it(`${moduleId} owns ${table}`, () => {
            const manifest = JSON.parse(
                fs.readFileSync(path.join(process.cwd(), "module-sources", moduleId, "module.json"), "utf8"),
            ) as { searchProviders?: { indexes?: { table: string }[] }[] };
            const tables = (manifest.searchProviders ?? []).flatMap((sp) =>
                (sp.indexes ?? []).map((i) => i.table),
            );
            expect(tables).toContain(table);
        });
    }
});

describe("a module's search", () => {
    // Postgres reads an expression index only for the identical expression,
    // so a handler that matched over other columns than its manifest indexes
    // would answer correctly and scan the whole table to do it.
    const providers = fs.readdirSync(path.join(process.cwd(), "module-sources"))
        .map((id) => ({ id, file: path.join(process.cwd(), "module-sources", id, "module.json") }))
        .filter(({ file }) => fs.existsSync(file))
        .flatMap(({ id, file }) => {
            const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as { searchProviders?: { handler: string; indexes?: { columns: string[] }[] }[] };
            return (manifest.searchProviders ?? []).filter((sp) => sp.indexes?.length).map((sp) => ({ id, sp }));
        });

    it("is found in the modules that declare an index", () => {
        expect(providers.length).toBeGreaterThanOrEqual(4);
    });

    for (const { id, sp } of providers) {
        it(`${id} matches over the columns its index is built from`, () => {
            const source = fs.readFileSync(path.join(process.cwd(), "module-sources", id, sp.handler), "utf8");
            const declared = /const COLUMNS = (\[[^\]]*\]);/.exec(source);
            expect(declared, "the handler names its columns once, as COLUMNS").not.toBeNull();
            expect(JSON.parse(declared![1])).toEqual(sp.indexes![0].columns);
            expect(source).toContain("searchMatches(COLUMNS, q)");
            expect(source).not.toMatch(/to_tsvector\(/);
        });
    }
});

