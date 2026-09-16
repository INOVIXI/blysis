import { test, expect } from "@playwright/test";

/**
 * What the server sent is what the browser keeps.
 *
 * Every module page threw "Hydration failed because the server rendered HTML
 * didn't match the client", so React discarded the tree it had been given and
 * built a second one in the browser. Core's own pages were clean, which is
 * what located it: the generated page registry reached its components through
 * `next/dynamic` with a full screen spinner as the `loading` fallback, and
 * both mount points are server components. The server streamed the spinner
 * into the first pass; the client, already holding the module because
 * `dynamic()` from a server component splits nothing, rendered the page in its
 * place.
 *
 * So the pages were paid for twice - once server side and thrown away, once in
 * the browser - and a visitor saw a spinner covering the screen before content
 * that the server had already written.
 *
 * A page error is the whole rule. React reports a hydration mismatch as an
 * uncaught error, which is the one signal that does not depend on knowing
 * which component went wrong next time.
 */

/** One per shape: core, a module list, a module detail, a built page. */
const PAGES = ["/en", "/en/activity", "/en/store", "/en/forum", "/en/blog"];

for (const path of PAGES) {
    test(`${path} keeps the tree the server sent`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message.split("\n")[0]));

        await page.goto(path, { waitUntil: "domcontentloaded" });
        // Hydration happens after the first paint, and a module page fetches
        // before it settles.
        await page.waitForTimeout(3000);

        expect(errors, `${path} threw during hydration`).toEqual([]);
    });
}

test("a module page is written by the server, not drawn after it arrives", async ({ request }) => {
    // The spinner is the tell: it was the `loading` fallback of a boundary
    // that should never have been there.
    const html = await (await request.get("/en/store")).text();
    expect(html).not.toContain("lucide-loader-circle");
    // And the page itself is in that HTML rather than fetched afterwards.
    expect(html).toContain("og:title");
});
