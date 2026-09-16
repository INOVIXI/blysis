import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Nothing imports the whole icon set to look one icon up by name.
 *
 * Three screens answered the same question - "a module named this icon in its
 * manifest, draw it" - with `import * as LucideIcons from "lucide-react"` and
 * `lib[name] || Fallback`. A namespace import cannot be tree shaken: the
 * bundler has to assume every name is reachable, so all 1,723 icon modules and
 * the barrel that lists them landed in that route's chunk group, and each of
 * the three groups got its own private copy.
 *
 * Measured on a production build, gzipped:
 *
 *     the icon set + barrel, per chunk group      189 KB
 *     module pages (/[locale]/[...slug])          679 KB first load, 27% of it this
 *     admin routes, all 48 of them                687 KB first load, 28% of it this
 *     duplicate icon chunks on disk              1.94 MB
 *
 * `lucide-react/dynamic` fetches one icon's own chunk, which is what `NavIcon`
 * wraps and what every one of the three now calls. Named imports are not the
 * problem and stay: `import { Search, File } from "lucide-react"` shakes down
 * to the two, and the core home page loads neither the barrel nor an icon
 * chunk.
 */

const ROOT = process.cwd();
const ROOTS = ["src", "module-sources", "themes"];
/**
 * Every way of reaching the whole barrel at once.
 *
 * `require()` was the fourth call site and the one that survived the first
 * pass of this rule: it is `import *` wearing different syntax, and it kept
 * 133 KB gzipped of icons on all 48 admin routes after the other three were
 * gone. A rule that only knows one spelling finds three of four.
 */
const WHOLE_BARREL = [
    /import\s+\*\s+as\s+\w+\s+from\s+["']lucide-react["']/,
    /require\s*\(\s*["']lucide-react["']\s*\)/,
    /\bimport\s*\(\s*["']lucide-react["']\s*\)/,
    /export\s+\*\s+from\s+["']lucide-react["']/,
];

const NAMESPACE_IMPORT = {
    test: (source: string) => WHOLE_BARREL.some((pattern) => pattern.test(source)),
};

/**
 * The file with its comments taken out.
 *
 * The prose above describes the import it forbids, in as many words, and
 * without this the component that fixed it was the first thing the rule
 * failed.
 */
function code(source: string): string {
    return stripComments(source);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // Codegen output and installed copies mirror what is authored.
            if (entry.name === "generated" || entry.name === "node_modules") continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe("an icon named at runtime", () => {
    const files = ROOTS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

    it("is found by the scan at all", () => {
        expect(files.length).toBeGreaterThan(500);
        expect(files.some((f) => f.endsWith("NavIcon.tsx"))).toBe(true);
    });

    it("is fetched by name, never taken from a bundled copy of the set", () => {
        const offenders = files
            .filter((file) => NAMESPACE_IMPORT.test(code(fs.readFileSync(file, "utf8"))))
            .map((file) => path.relative(ROOT, file));
        expect(offenders).toEqual([]);
    });

    it("has a component to be fetched by", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/core/components/ui/NavIcon.tsx"), "utf8");
        expect(source).toContain('from "lucide-react/dynamic"');
        // The fallback is what let the three call sites move: each of them
        // showed a default icon rather than nothing for an unknown name.
        expect(source).toContain("fallback");
    });

    it("can say no", () => {
        expect(NAMESPACE_IMPORT.test('import * as LucideIcons from "lucide-react";')).toBe(true);
        expect(NAMESPACE_IMPORT.test('const lib = require("lucide-react");')).toBe(true);
        expect(NAMESPACE_IMPORT.test('import { Search } from "lucide-react";')).toBe(false);
        // The dynamic loader is the point of the rule, not a breach of it.
        expect(NAMESPACE_IMPORT.test('import { DynamicIcon } from "lucide-react/dynamic";')).toBe(false);
    });
});
