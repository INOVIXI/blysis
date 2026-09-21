// @vitest-environment node
/**
 * A hook handler runs wherever the bus runs, and the bus is not always a page.
 *
 * `auth()` reads the incoming request's headers. Inside a route or a server
 * component there is one; inside a seed, a cron job or a CLI there is not,
 * and it does not return null - it throws `headers was called outside a
 * request scope`.
 *
 * The bus catches whatever a listener throws, because a module hook that
 * throws must not take a page down. That is the right call for a page and the
 * wrong one for a diagnosis: the filter answers with the value it was given,
 * the caller cannot tell that from a genuine empty answer, and nothing says
 * anything went wrong.
 *
 * Measured on 2026-09-21. `store`'s `comparison.columns` handler asked
 * `auth()` for the signed-in shopper, to price the next rung up for somebody
 * already on one. Run from the demo seed it threw, the filter answered with
 * no columns, the seed read that as "this shelf has nothing to compare" and
 * wrote its table bound to nothing. `/store?category=ranks` then drew a
 * comparison of no products - five active ranks and an empty page - and
 * re-running the seed could never repair it.
 *
 * Nobody signed in is the correct answer when there is no request, and it is
 * already the answer for most callers when there is one.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Every hook handler a module ships, and core's own. */
function hookHandlers(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (entry.name.endsWith(".ts")) found.push(full);
        }
    };
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        walk(path.join(ROOT, "module-sources", id, "hooks"));
    }
    walk(path.join(ROOT, "src/core/hooks"));
    return found;
}

describe("a hook handler", () => {
    it("does not ask for a session in a way that throws when there is no request", () => {
        const unguarded = hookHandlers().filter((file) => {
            const source = fs.readFileSync(file, "utf8");
            const asks = /\bawait\s+(auth|getTranslations)\(/.exec(source);
            if (!asks) return false;
            // A `.catch` on the promise is not enough: `auth()` throws
            // synchronously when no request is in scope, so the rejection
            // handler is never reached. Only a `try` around the call catches
            // it, which is why this looks for the block rather than the
            // tidier-looking form.
            const guarded = new RegExp(`try\\s*\\{[\\s\\S]{0,300}?\\bawait\\s+${asks[1]}\\(`);
            return !guarded.test(source);
        });
        expect(
            unguarded.map((file) => path.relative(ROOT, file)),
            "a handler here runs from a seed and a cron as well as from a page, and " +
            "`auth()` throws where there is no request. The bus swallows it and the " +
            "filter silently answers with what it was given. Use `auth().catch(() => null)`",
        ).toEqual([]);
    });

    it("is looking at the handlers it thinks it is", () => {
        // A census that walks the wrong directory passes for the wrong reason.
        const files = hookHandlers();
        expect(files.length).toBeGreaterThan(20);
        expect(files.some((f) => f.includes("store/hooks/"))).toBe(true);
    });
});
