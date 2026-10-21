import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "../..");

/**
 * Code nothing can reach.
 *
 * Six files sat under `src/core` that no import anywhere resolved to. Two of
 * them were duplicates of something core already had, one was superseded by a
 * rewrite that left the original behind, and one was a back-compatibility shim
 * for an API no caller ever used. The other two were worse than dead: their
 * own doc comments described them as pieces a module or theme could render,
 * and the SDK boundary - modules import core only through `@/core/sdk*` - made
 * that impossible, so the store went and hand-rolled its own breadcrumb
 * instead. That copy was the one whose crumbs a keyboard could not reach.
 *
 * A file under `src/core` is either reachable or it is a lie about what the
 * platform offers.
 */

/** Filenames the App Router owns; nothing imports these by name. */
const ROUTER_CONVENTIONS = /[/\\](page|layout|route|error|loading|not-found|global-error|template|default|sitemap|robots|opengraph-image|twitter-image|icon|apple-icon|manifest)\.tsx?$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // Written by the registry generator, and gitignored.
            if (entry.name === "node_modules" || entry.name === "generated") continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** Every file that could plausibly import from core. */
function importers(): { file: string; source: string }[] {
    const files: string[] = [];
    for (const dir of ["src", "scripts", "tests", "module-sources"]) {
        sourceFiles(path.join(root, dir), files);
    }
    // next-intl's request config is named in next.config.ts, not imported.
    for (const config of ["next.config.ts", "vitest.config.mts", "prisma.config.ts"]) {
        const full = path.join(root, config);
        if (fs.existsSync(full)) files.push(full);
    }
    return files.map((file) => ({ file, source: fs.readFileSync(file, "utf8") }));
}

/**
 * The specifiers that would resolve to `file`: its `@/` alias, the alias of the
 * directory it indexes, and the relative forms a sibling would write.
 */
function specifiersFor(file: string): string[] {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const noExt = rel.replace(/\.tsx?$/, "");
    const alias = "@/" + noExt.replace(/^src\//, "");
    const specs = [alias];
    // `@/core/sdk` resolves to `src/core/sdk/index.ts`.
    if (alias.endsWith("/index")) specs.push(alias.slice(0, -"/index".length));
    const base = path.basename(noExt);
    specs.push(`/${base}`);
    // next.config.ts names its files by repo-relative path, extension and all.
    specs.push(`./${rel}`);
    specs.push(rel);
    return specs;
}

describe("every file under src/core", () => {
    const core = sourceFiles(path.join(root, "src/core"));
    const all = importers();

    it("scans a whole core", () => {
        expect(core.length).toBeGreaterThan(100);
    });

    // Quadratic in the size of core - every file's specifiers against every
    // other file's text - so it runs in a couple of seconds idle and blew the
    // 5s default on a loaded host, failing a green suite for no reason.
    it("is reachable from somewhere", { timeout: 60_000 }, () => {
        const unreachable: string[] = [];

        for (const file of core) {
            const rel = path.relative(root, file).split(path.sep).join("/");
            if (ROUTER_CONVENTIONS.test(rel)) continue;
            // Ambient declarations are picked up by the compiler, not imported.
            if (rel.endsWith(".d.ts")) continue;

            const specs = specifiersFor(file);
            const reached = all.some(({ file: other, source }) => {
                if (other === file) return false;
                return specs.some((spec) => source.includes(`"${spec}"`) || source.includes(`'${spec}'`) || source.includes(`${spec}"`) || source.includes(`${spec}'`));
            });
            if (!reached) unreachable.push(rel);
        }

        expect(unreachable).toEqual([]);
    });
});

/**
 * The two that were unreachable *because* of the SDK boundary are exported
 * now. Pinning them keeps the fix from being quietly undone: dropping the
 * export would put each file straight back into the state above.
 */
describe("core pieces a module is told it can use", () => {
    it("are reachable through the SDK", () => {
        const ui = fs.readFileSync(path.join(root, "src/core/sdk/ui.ts"), "utf8");
        expect(ui).toContain("@/core/components/ui/breadcrumb");

        const server = fs.readFileSync(path.join(root, "src/core/sdk/server.ts"), "utf8");
        expect(server).toContain("@/core/components/homepage/ActivityFeedSection");
    });
});
