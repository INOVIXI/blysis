// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { buildMarketplace } from "../../scripts/build-marketplace";

/**
 * A published archive is a function of what the module says, and nothing else.
 *
 * `zip -r` writes each file's mtime and atime into the entry, so the bytes of a
 * published ZIP depended on when someone last opened the file rather than on
 * what the file contained. Merely reading a module.json and rebuilding produced
 * a different artifact: two commits in this repository carried .zip changes for
 * modules nobody had touched. A fresh clone, where git sets every mtime to
 * checkout time, could not reproduce any of the seventy-eight. Entry order came
 * from readdir, which is not stable across filesystems either.
 *
 * That costs three things. Review noise, where an unrelated archive shows as
 * modified. Any integrity check keyed on the archive's hash, which can never
 * agree twice. And the ability to answer "is the published ZIP the one this
 * source builds" by comparing bytes.
 *
 * `index.json` had the same shape of problem one level up: every module's
 * `updatedAt` was stamped with the build clock, so the catalogue claimed all
 * seventy-eight were updated today after any build, and the admin modules
 * screen, which prints that date and sorts by it, said so.
 */

const ROOT = process.cwd();
const MARKETPLACE = path.join(ROOT, "module-marketplace");
/** The ZIP epoch, as scripts/lib/deterministic-zip.ts writes it. */
const EPOCH = { year: 1980, month: 1, day: 1 };

function archives(): string[] {
    return fs
        .readdirSync(MARKETPLACE)
        .filter((f) => f.endsWith(".zip"))
        .sort();
}

describe("every published archive", () => {
    const names = archives();

    it("is there to check", () => {
        expect(names.length).toBeGreaterThan(50);
    });

    it("carries no timestamp taken from the filesystem", () => {
        const offenders: string[] = [];
        for (const name of names) {
            for (const entry of new AdmZip(path.join(MARKETPLACE, name)).getEntries()) {
                const when = entry.header.time;
                if (
                    when.getFullYear() !== EPOCH.year ||
                    when.getMonth() + 1 !== EPOCH.month ||
                    when.getDate() !== EPOCH.day
                ) {
                    offenders.push(`${name}: ${entry.entryName} at ${when.toISOString()}`);
                    break;
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("lists its entries in one order any machine would produce", () => {
        const unsorted: string[] = [];
        for (const name of names) {
            const entries = new AdmZip(path.join(MARKETPLACE, name)).getEntries().map((e) => e.entryName);
            if (entries.join("\n") !== [...entries].sort().join("\n")) unsorted.push(name);
        }
        expect(unsorted).toEqual([]);
    });

    it("holds files only, so no directory entry can vary", () => {
        const withDirs: string[] = [];
        for (const name of names) {
            const dirs = new AdmZip(path.join(MARKETPLACE, name)).getEntries().filter((e) => e.isDirectory);
            if (dirs.length > 0) withDirs.push(`${name}: ${dirs.length}`);
        }
        expect(withDirs).toEqual([]);
    });
});

describe("the build", () => {
    let root: string;

    function write(rel: string, text: string) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    const manifest = (version: string) => JSON.stringify({ id: "shop", name: "Shop", version });
    const archive = () => fs.readFileSync(path.join(root, "module-marketplace/shop.zip"));
    const catalog = () =>
        JSON.parse(fs.readFileSync(path.join(root, "module-marketplace/index.json"), "utf8")) as {
            modules: { id: string; updatedAt: string }[];
        };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-build-"));
        write("messages-core/en.json", "{}");
        write("src/core/lib/hooks.ts", "");
        write("module-sources/shop/module.json", manifest("1.0.0"));
        write("module-sources/shop/lib/price.ts", "export const price = 1;\n");
        write("module-sources/shop/lib/.DS_Store", "finder");
        fs.mkdirSync(path.join(root, "module-marketplace"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("writes the same bytes from the same source, whenever it runs", () => {
        buildMarketplace(root, new Date("2026-01-01T00:00:00Z"));
        const first = archive();
        fs.rmSync(path.join(root, "module-marketplace/shop.zip"));
        // A later clock, and a file whose mtime moved, change nothing.
        fs.utimesSync(path.join(root, "module-sources/shop/lib/price.ts"), new Date(), new Date());
        buildMarketplace(root, new Date("2026-06-01T00:00:00Z"));
        expect(archive().equals(first)).toBe(true);
        const entries = new AdmZip(path.join(root, "module-marketplace/shop.zip")).getEntries();
        expect(entries.map((e) => e.entryName)).toEqual(["lib/price.ts", "module.json"]);
        expect(entries.every((e) => e.header.time.getFullYear() === EPOCH.year)).toBe(true);
    });

    it("leaves an archive that already holds its source exactly as it was", () => {
        // Whichever zlib compressed it: rebuilding on another machine must not
        // turn every unchanged archive into a diff.
        buildMarketplace(root);
        const holding = new AdmZip(path.join(root, "module-marketplace/shop.zip"));
        holding.writeZip(path.join(root, "module-marketplace/shop.zip"));
        const before = archive();
        expect(buildMarketplace(root).written).toEqual([]);
        expect(archive().equals(before)).toBe(true);
    });

    it("writes no archive when the catalog does not validate", () => {
        // A module that breaks the SDK boundary used to have a published ZIP
        // before the check that refused it had run.
        write("module-sources/shop/lib/deep.ts", 'import { prisma } from "@/core/lib/db";\n');
        const result = buildMarketplace(root);
        expect(result.errors.join("\n")).toContain("module-sources/shop/lib/deep.ts:1");
        expect(fs.existsSync(path.join(root, "module-marketplace/shop.zip"))).toBe(false);
    });

    it("refuses a listener on a hook nothing emits", () => {
        write("module-sources/shop/module.json", JSON.stringify({
            id: "shop", name: "Shop", version: "1.0.0", hookListeners: [{ hook: "order.complted" }],
        }));
        expect(buildMarketplace(root).errors.join("\n")).toContain("shop: order.complted");
    });

    it("keeps a module's date unless its published version moved", () => {
        buildMarketplace(root, new Date("2026-01-01T00:00:00Z"));
        buildMarketplace(root, new Date("2026-02-01T00:00:00Z"));
        expect(catalog().modules[0].updatedAt).toBe("2026-01-01T00:00:00Z");

        write("module-sources/shop/module.json", manifest("1.1.0"));
        buildMarketplace(root, new Date("2026-03-01T00:00:00Z"));
        expect(catalog().modules[0].updatedAt).toBe("2026-03-01T00:00:00Z");
    });
});

describe("the catalog", () => {
    const index = JSON.parse(fs.readFileSync(path.join(MARKETPLACE, "index.json"), "utf8")) as {
        updated: string;
        updatedAt: string;
        modules: { id: string; version: string; updatedAt: string; zip: string }[];
    };

    it("says it was updated when its newest module was, not when the build ran", () => {
        const newest = index.modules.map((m) => m.updatedAt).sort().at(-1);
        expect(index.updatedAt).toBe(newest);
        expect(index.updated).toBe(index.updatedAt.slice(0, 10));
    });

    it("dates no module later than the catalog", () => {
        const ahead = index.modules.filter((m) => m.updatedAt > index.updatedAt).map((m) => m.id);
        expect(ahead).toEqual([]);
    });

    it("points every entry at an archive that exists", () => {
        const missing = index.modules.filter((m) => !fs.existsSync(path.join(MARKETPLACE, m.zip))).map((m) => m.id);
        expect(missing).toEqual([]);
    });
});
