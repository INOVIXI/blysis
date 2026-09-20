import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What crosses from the server into a Client Component is plain data.
 *
 * Every visit to a shop category threw: "Only plain objects can be passed to
 * Client Components. Decimal objects are not supported." The shelf read
 * products with Prisma and spread the rows straight into `<ProductCard>`, and
 * two of those columns - `comparePrice`, `salePrice` - are `Decimal`, which is
 * a class instance and does not survive the boundary.
 *
 * The reason nobody saw it in the types is the second rule below. The page
 * wrote `product={product as never}`. `never` is assignable to every type, so
 * that cast tells the compiler to stop asking - the card declared
 * `price: number` and got a `Decimal`, and the only thing that objected was
 * the browser. A cast that agrees with anything is not a cast, and the one
 * place it appeared is the one place this happened.
 *
 * `readProduct` had already converted the same two columns, with a comment
 * saying why. The listing beside it had not. That is the shape of the thing
 * this gate is for: the fix exists, in one of the two readers.
 */

const ROOT = process.cwd();

/** Readers whose result is handed to a component rather than to JSON. */
const READERS = [
    {
        file: "module-sources/store/lib/read-store.ts",
        columns: ["comparePrice"],
    },
    {
        file: "module-sources/store/lib/read-product.ts",
        columns: ["comparePrice", "salePrice"],
    },
];

/** Columns the Prisma schema declares as `Decimal`. */
function decimalColumns(schema: string): Set<string> {
    const found = new Set<string>();
    for (const match of schema.matchAll(/^\s*(\w+)\s+Decimal\??\s/gm)) found.add(match[1]);
    return found;
}

function sources(dir: string, match: RegExp): { file: string; source: string }[] {
    const out: { file: string; source: string }[] = [];
    const walk = (at: string) => {
        if (!fs.existsSync(at)) return;
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(at, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (match.test(entry.name)) out.push({ file: path.relative(ROOT, full), source: fs.readFileSync(full, "utf8") });
        }
    };
    walk(path.join(ROOT, dir));
    return out;
}

describe("a server page hands over plain data", () => {
    it("knows which store columns are Decimal", () => {
        const columns = decimalColumns(fs.readFileSync(path.join(ROOT, "module-sources/store/schema.prisma"), "utf8"));
        expect(columns.has("price")).toBe(true);
        expect(columns.has("comparePrice")).toBe(true);
        expect(columns.has("salePrice")).toBe(true);
    });

    it("converts every Decimal a reader passes on", () => {
        const missing: string[] = [];
        for (const reader of READERS) {
            const source = fs.readFileSync(path.join(ROOT, reader.file), "utf8");
            for (const column of reader.columns) {
                // `Number(x.comparePrice)` or `Number(comparePrice)` - either
                // way the value stops being a Decimal before it leaves.
                if (!new RegExp(`Number\\((?:[\\w.]*\\.)?${column}\\)`).test(source)) {
                    missing.push(`${reader.file}: ${column} leaves as a Decimal`);
                }
            }
        }
        expect(missing, missing.join("\n")).toEqual([]);
    });

    it("casts no component prop to never", () => {
        const offenders: string[] = [];
        for (const { file, source } of [...sources("src", /\.tsx$/), ...sources("module-sources", /\.tsx$/)]) {
            // `something={ ... as never}` - a prop whose type was argued away.
            for (const match of source.matchAll(/(\w+)=\{[^{}]*\bas never\b[^{}]*\}/g)) {
                offenders.push(`${file}: ${match[0].trim()}`);
            }
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });
});
