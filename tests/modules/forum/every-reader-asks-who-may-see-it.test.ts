/**
 * A private category has more than one door.
 *
 * The permission matrix is easy to apply on the page that lists a category and
 * easy to forget everywhere else, and forum topics are read in seven other
 * places: the topic list, one topic, the statistics, the site search, the
 * sitemap, a member's profile, and the moderation queue. A staff-only section
 * that is hidden on the forum page and named in the search results, or listed
 * in the sitemap for a crawler, is not hidden.
 *
 * It is the same failure every time and it never looks like one: the code that
 * leaks is a query somebody wrote before the permission existed, and it keeps
 * working perfectly.
 *
 * So there is one function that answers "which categories may this reader
 * see", and this holds every reader to going through it. A reader that must
 * not - the moderation queue exists to show what a moderator would otherwise
 * miss - says so by name, with the reason.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FORUM = path.join(ROOT, "module-sources", "forum");

/** Reading topics or categories to show them to somebody. */
const READS = /prisma\.(forumTopic|forumCategory)\.(findMany|findFirst|findUnique|count|groupBy|aggregate)/;
/**
 * Asking who this reader is allowed to see. Two doors in
 * `lib/visible-categories.ts` - the whole list, or one category - and
 * `readTopic`, which is one topic with the same question already asked inside
 * it. That third one exists because the page renders a topic on the server
 * now, and the page and the endpoint must not each carry their own copy of the
 * rule.
 */
const ASKS = /visibleCategoryIds|accessToCategory|readTopic/;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * Readers that must see everything, each with the reason.
 *
 * A bare name is not a bypass: the reason has to be one somebody can argue
 * with.
 */
const SEES_EVERYTHING: Record<string, string> = {
    "moderation/topics.ts":
        "The moderation queue. It exists to show a moderator what they would otherwise miss, and a report about a private category is exactly the report nobody else can act on.",
    "seed.ts":
        "Demo data being written, not read for anybody.",
    "api/categories/permissions/route.ts":
        "The matrix itself, behind an admin check. Filtering it by the matrix would hide a category from the person writing the rule that hides it.",
    "api/categories/[id]/route.ts":
        "One category as an operator edits it, behind an admin check. The matrix is what this screen is for, so filtering by it would hide the category from the person setting it.",
    "api/stats/route.ts":
        "The admin dashboard's numbers, behind an admin check at the top of the handler. An operator counting their own forum is the one reader who should be told about every category, including the ones they made private.",
    "lib/permissions.ts":
        "The decision itself, with no database behind it: it is handed the rules rather than reading them.",
    "lib/visible-categories.ts":
        "The one place that answers the question.",
    "lib/read-topic.ts":
        "One topic with the question already asked: it calls accessToCategory itself, and is what both the page and the endpoint go through so the rule is written once.",
};

const files = walk(FORUM);

describe("every place that reads the forum", () => {
    it("finds the readers", () => {
        // A guard on the test: a broken walk would pass by finding none.
        expect(files.filter((file) => READS.test(fs.readFileSync(file, "utf8"))).length)
            .toBeGreaterThanOrEqual(5);
    });

    it("asks who the reader may see, or says why it need not", () => {
        const leaking: string[] = [];
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            if (!READS.test(source)) continue;
            const rel = path.relative(FORUM, file);
            if (SEES_EVERYTHING[rel]) continue;
            if (!ASKS.test(source)) leaking.push(rel);
        }
        expect(leaking).toEqual([]);
    });

    it("narrows every query in a file, not just the first one somebody fixed", () => {
        /*
         * Mentioning the helper is not the same as using it everywhere. The
         * forum search has two paths - a full-text query and an ILIKE
         * fallback - and narrowing one of them looks exactly like narrowing
         * the search: the file names the helper, the gate above is happy, and
         * a signed-out visitor is handed the title and the opening line of
         * every topic in a staff-only section. Measured, on a running site.
         *
         * So a raw query against the topics table has to say `categoryId`
         * too. It is the only word that can narrow it, and SQL written by
         * hand is where a filter goes missing.
         */
        const unnarrowed: string[] = [];
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            const rel = path.relative(FORUM, file);
            if (SEES_EVERYTHING[rel]) continue;
            for (const match of source.matchAll(/\$queryRaw[\s\S]{0,600}?ForumTopic[\s\S]{0,600}?`/g)) {
                if (!/categoryId/.test(match[0])) unnarrowed.push(rel);
            }
        }
        expect(unnarrowed).toEqual([]);
    });

    it("names a reason for every reader that sees everything", () => {
        const bare = Object.entries(SEES_EVERYTHING)
            .filter(([, reason]) => reason.trim().length < 30)
            .map(([file]) => file);
        expect(bare).toEqual([]);
    });
});
