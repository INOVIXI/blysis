/**
 * A public list that grows offers a way through it.
 *
 * Measured across the modules on 2026-09-08: three of the fourteen public
 * lists had a pager. The rest drew whatever the endpoint happened to return
 * and stopped there - the store asked for twelve products and rendered them
 * with no way to reach the thirteenth, so a category with thirty quietly
 * ended at its first screenful, and every suggestion, download, trophy,
 * ticket and notification past the first load simply was not on the page.
 *
 * None of it looked broken, which is why it lasted: a list that stops has
 * exactly the shape of a list that ended.
 *
 * The rule is about growth, not length. A list bounded by something an
 * operator sets by hand - the four vote sites, the team - is named below with
 * what bounds it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pageSource } from "./module-page-source";

const ROOT = process.cwd();

/** Public pages whose lists cannot grow without an operator adding rows. */
const BOUNDED: Record<string, string> = {
    "module-sources/staff/pages/public/page.tsx":
        "The team. An operator adds each member by hand, and a community with more than a screenful of staff has a different problem.",
    "module-sources/vote/pages/public/page.tsx":
        "The voting sites, added one at a time in the admin. Four is a lot; there is no feed behind it.",
    "module-sources/wheel/pages/public/page.tsx":
        "The prizes on one wheel, which have to fit on the wheel to be drawn at all.",
    "module-sources/leaderboard/pages/public/page.tsx":
        "A top twenty by definition: the endpoint takes a limit and the board is the answer to how many it was asked for.",
    "module-sources/help-center/pages/public/help/page.tsx":
        "Categories and the five most read articles. Both are bounded by what the endpoint is asked for.",
    "module-sources/store/pages/public/cart/page.tsx":
        "One reader's cart, which they filled themselves.",
    "module-sources/store/pages/public/vip/page.tsx":
        "A comparison table of the VIP tiers, which is a handful by design.",
    "module-sources/comparison-table/pages/public/[slug]/page.tsx":
        "One comparison, read whole. Paging it is the thing that would break it: half a table answers no question, and an operator writing thirty features has written a long page on purpose.",
    "module-sources/player-profiles/pages/public/[username]/page.tsx":
        "One profile: its linked accounts and its trophies, both bounded per person.",
};

/** Pages that render a list of rows a visitor reads. */
function listPages(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "admin") continue;
                walk(full);
            } else if (entry.name === "page.tsx") {
                const source = fs.readFileSync(full, "utf8");
                // A `.map(` over state, rather than over a fixed list of tabs
                // or filter chips, is what makes a page a list.
                if (/\b(?:rows|items|entries|articles|topics|products|tickets|downloads|trophies|suggestions|punishments|notifications|referrals)\.map\(/.test(source)
                    || /\bpaged\.rows\.map\(/.test(source)) {
                    out.push(path.relative(ROOT, full));
                }
            }
        }
    };
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        const pages = path.join(ROOT, "module-sources", id, "pages");
        if (fs.existsSync(pages)) walk(pages);
    }
    return out.sort();
}

describe("the public lists", () => {
    const pages = listPages();

    it("finds lists to check", () => {
        expect(pages.length).toBeGreaterThan(5);
    });

    it("each offer a way past the first screenful", () => {
        const unpaged: string[] = [];
        for (const page of pages) {
            if (BOUNDED[page]) continue;
            // A page that reads on the server hands the paging to the screen
            // it renders, so read the page with what it imports.
            const moduleRoot = path.join(ROOT, page.split("/").slice(0, 2).join("/"));
            const source = pageSource(path.join(ROOT, page), moduleRoot);
            const pages_ = /<Pagination\b/.test(source) || /usePagedRows\(/.test(source)
                // The blog and the forum page through the URL and the API
                // rather than through the shared component.
                || /setPage\(/.test(source) || /blogHref\(filter, page/.test(source);
            if (!pages_) unpaged.push(page);
        }
        expect(unpaged).toEqual([]);
    });

    it("keeps the bounded list to pages that exist, each with a reason", () => {
        for (const [page, reason] of Object.entries(BOUNDED)) {
            expect(fs.existsSync(path.join(ROOT, page)), page).toBe(true);
            expect(reason.length, `${page} needs a real reason`).toBeGreaterThan(40);
        }
    });
});
