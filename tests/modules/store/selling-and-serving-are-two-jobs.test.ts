// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../../unit/source-text";

/**
 * Setting the prices and handling the orders are two jobs.
 *
 * They were one - `isAdmin` - so the person who answers "where is my order"
 * had to be an administrator of the whole site, with the payment credentials
 * and the database that came with it. Every shop that has ever employed two
 * people separates these.
 */

const ROOT = process.cwd();
const dir = path.join(ROOT, "module-sources/store/api");

function sources(): { file: string; body: string }[] {
    const out: { file: string; body: string }[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".ts")) {
                out.push({ file: path.relative(dir, full), body: stripComments(fs.readFileSync(full, "utf8")) });
            }
        }
    };
    walk(dir);
    return out;
}

const FILES = sources();

describe("the shop's endpoints", () => {
    it("has endpoints to check", () => {
        expect(FILES.length).toBeGreaterThan(10);
    });

    it("asks for a permission rather than for the admin role", () => {
        const stillAdmin = FILES.filter((f) => /\bisAdmin\s*\(/.test(f.body)).map((f) => f.file);
        expect(stillAdmin).toEqual([]);
    });

    it("hands the orders to whoever serves them", () => {
        const orders = FILES.find((f) => f.file === "admin/orders/route.ts");
        expect(orders?.body).toContain('"store.orders"');
    });

    it("keeps the shelf to whoever stocks it", () => {
        const products = FILES.find((f) => f.file === "admin/products/[id]/route.ts");
        expect(products?.body).toContain('"store.manage"');
    });
});
