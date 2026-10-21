/**
 * Reading source as text, for the gates that do.
 *
 * Many gates ask a structural question by scanning source and have to ignore
 * what the comments say - a doc comment naming `<main>` is not a `<main>`.
 * Twenty of them each wrote the same two-line stripper:
 *
 *     source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
 *
 * It is wrong, and wrong in the direction that hides failures. `/*` inside a
 * string opens a comment it cannot see the end of, so the strip runs on to
 * the next `*​/` anywhere in the file and takes everything between with it.
 * `accept="image/*"` is the common one. Measured across `src`, `scripts` and
 * `module-sources` on 2026-09-16: 39 files carry a string-embedded `/*`, and
 * on 14 the strip swallowed far more than their comments - 23,708 characters
 * of `scripts/validate-module.ts`, 11,399 of `scripts/generate-registry.ts`,
 * 9,401 of `src/core/lib/module-types.ts`.
 *
 * A gate reading a haystack with holes in it cannot fail, which is the worst
 * way for a gate to be broken.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Comments removed, strings left alone.
 *
 * A small scanner rather than a regex, because the thing that has to be
 * understood is exactly what a regex cannot see: whether the `/*` it found is
 * inside a quote. Template literals count, and so do their `${}` holes, since
 * a comment can live inside one.
 */
export function stripComments(source: string): string {
    let out = "";
    let i = 0;
    /** What we are inside of, if anything. */
    let quote: '"' | "'" | "`" | null = null;

    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];

        if (quote) {
            // A backslash escapes the next character, including the quote.
            if (c === "\\") {
                out += c + (next ?? "");
                i += 2;
                continue;
            }
            if (c === quote) quote = null;
            out += c;
            i++;
            continue;
        }

        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            out += c;
            i++;
            continue;
        }

        if (c === "/" && next === "*") {
            const end = source.indexOf("*/", i + 2);
            // An unterminated block comment ends the file; so does the strip.
            i = end === -1 ? source.length : end + 2;
            continue;
        }

        if (c === "/" && next === "/") {
            const end = source.indexOf("\n", i);
            i = end === -1 ? source.length : end;
            continue;
        }

        out += c;
        i++;
    }

    return out;
}

/**
 * `path.relative`, spelled with forward slashes on every platform.
 *
 * Gates name files in their allow-lists and messages the way the repository
 * does, `src/core/lib/db.ts`, and compare them with what a walk of the tree
 * found. `path.relative` answers in the platform's separator, so on Windows
 * every comparison missed: an allow-listed file was reported as both an
 * offender and an entry that "does not exist", and a list of expected
 * readers found none of them. Measured on 2026-10-21: 71 failures on a
 * Windows checkout, every one of them this.
 */
export function relativePath(from: string, to: string): string {
    return path.relative(from, to).split(path.sep).join("/");
}

/**
 * `grep -rn` over part of the tree, in-process.
 *
 * Gates shelled out to `grep` and `sh -c "ls -d ..."` and caught the failure,
 * because grep exits 1 when nothing matches. On a machine without either,
 * which is Windows from PowerShell or cmd, the same catch turned "could not
 * look" into "found nothing", and the gate passed without reading a file.
 * Lines come back the way grep prints them, `path:line:text`, with the path
 * relative to `root` and spelled with forward slashes.
 */
export function grepTree(root: string, pattern: string, paths: string[], extensions: string[]): string[] {
    const regex = new RegExp(pattern);
    const hits: string[] = [];
    const visit = (full: string) => {
        const stat = fs.statSync(full, { throwIfNoEntry: false });
        if (!stat) return;
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(full).sort()) visit(path.join(full, entry));
            return;
        }
        if (!extensions.some((ext) => full.endsWith(ext))) return;
        fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
            if (regex.test(line)) hits.push(`${relativePath(root, full)}:${i + 1}:${line}`);
        });
    };
    for (const p of paths) visit(path.join(root, p));
    return hits;
}

/** `module-sources/<id>/<sub>` for every module that has one, as `ls -d` printed them. */
export function moduleSourceDirs(root: string, sub: string): string[] {
    const sources = path.join(root, "module-sources");
    return fs
        .readdirSync(sources, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(sources, entry.name, sub)))
        .map((entry) => `module-sources/${entry.name}/${sub}`)
        .sort();
}
