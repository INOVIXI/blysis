import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * Waiting is said, not drawn.
 *
 * The panel had three loading vocabularies at once. A progress bar ran at the
 * top of the window on every navigation. Thirty-four `loading.tsx` files drew
 * a pulsing grey page under it, twenty-four of them the same generic list
 * shape with its default eight rows and five columns, none tuned to the
 * screen it stood for. Then the screen itself mounted and drew a third thing,
 * a spinner, because forty-four of the forty-eight admin pages fetch their
 * own data after mount.
 *
 * The drawings were wrong as well as surplus. The users list is twenty rows;
 * its placeholder was eight, so the page grew by twelve rows when the answer
 * came. The shop's placeholder card was `h-44` with `rounded-lg` against a
 * real card that is `aspect-[2/1]` with `rounded-xl`: at the width they are
 * drawn, 176px against 200px, and a different corner. A placeholder is a
 * second copy of a layout that nothing keeps in step with the first, and it
 * was already out of step.
 *
 * So the product does what a server rendered product does. The bar says a
 * navigation is running. A control that was clicked spins. A region still
 * waiting for its own request says so with `Waiting`, which shows nothing at
 * all for the first 300ms, because a placeholder that appears and vanishes
 * inside a third of a second reads as a glitch rather than as progress.
 *
 * `Skeleton` itself stays in `@/core/sdk/ui`. Removing a name from the
 * surface modules are written against is a major CORE_API_VERSION bump rather
 * than a tidy up, and a module author may still want one. This is about what
 * this product draws.
 */

const ROOT = join(__dirname, "..", "..");

/**
 * The primitive is still published; it is its use here that stopped. The
 * barrel is the line that publishes it, and the file that declares it.
 */
const PUBLISHES_THE_PRIMITIVE = ["src/core/components/ui/skeleton.tsx", "src/core/sdk/ui.ts"];

const TREES = ["src/app", "src/core", "module-sources"];

function filesIn(dir: string, match: RegExp, out: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name === "generated" || entry.name === "node_modules") continue;
            filesIn(rel, match, out);
        } else if (match.test(entry.name)) out.push(rel);
    }
    return out;
}

describe("a wait is not a drawing", () => {
    it("draws no placeholder in the shape of a page", () => {
        const offenders: string[] = [];
        for (const tree of TREES) {
            for (const file of filesIn(tree, /\.tsx?$/)) {
                if (PUBLISHES_THE_PRIMITIVE.includes(file)) continue;
                const src = fs.readFileSync(join(ROOT, file), "utf8");
                const code = stripComments(src);
                if (/animate-pulse/.test(code)) offenders.push(`${file} draws a pulsing block`);
                if (/\bSkeleton[A-Za-z]*\b/.test(code)) offenders.push(`${file} names a skeleton`);
            }
        }
        expect(offenders, "say the wait with Waiting, or let the progress bar say it").toEqual([]);
    });

    it("leaves the navigation to the progress bar", () => {
        const files = TREES.flatMap((tree) => filesIn(tree, /^loading\.tsx$/));
        expect(files, "a route that draws a fake page while the real one loads").toEqual([]);
    });

    it("has a way to say a region is waiting", () => {
        const waiting = fs.readFileSync(join(ROOT, "src/core/components/ui/waiting.tsx"), "utf8");
        // The whole point of it: nothing on screen until the wait is real.
        expect(waiting).toMatch(/300/);
        expect(fs.readFileSync(join(ROOT, "src/core/sdk/ui.ts"), "utf8")).toContain("Waiting");
    });
});
