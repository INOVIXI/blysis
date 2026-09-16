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
