import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "./source-text";

/**
 * A list query must have a ceiling.
 *
 * `findMany` with no `take` reads whatever the table holds. That is fine for a
 * table whose size an operator sets - roles, locales, payment providers - and
 * wrong for one that grows with use. The store's gift codes are generated in
 * batches from a form that takes a count, and every one of them was serialised
 * into a single response and rendered into a single table on every visit to
 * the admin screen. The blog index read every published article, with author
 * and category joined, to show a screenful. The admin article list did the
 * same with no cap at all.
 *
 * The rule: a `findMany` on a growing table either pages (`take` with `skip`),
 * caps (`take` alone, where the screen shows one batch and the cap is a
 * ceiling on a runaway install), or narrows to one owner. Anything else is in
 * EXEMPT with the reason it belongs there.
 */

const root = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["src/app", "src/core", "module-sources"];

/**
 * Tables that grow with use. Same list the index gate reasons about, because
 * it is the same question: which tables get big enough for the shape of a
 * query to matter.
 */
export const GROWING = new Set([
    "message", "conversation", "conversationParticipant", "notification", "revision",
    "activityLog", "activityFeedItem", "order", "orderItem", "payment", "cartItem",
    "blogComment", "blogArticle", "forumPost", "forumTopic", "ticket", "ticketMessage",
    "suggestion", "suggestionVote", "punishment", "vote", "voteLog", "creditTransaction",
    "emailJob", "userWarning", "userSession", "auditLog", "webhookLog", "formSubmission",
    "download", "licenseKey", "licenseActivation", "giftCode", "announcement", "user",
    "mediaItem", "apiKey", "ipBlock", "helpArticle", "staffApplication", "trophy",
    "userTrophy", "referral",
]);

/**
 * Reads a whole table on purpose. Each entry says why that is the right
 * answer rather than an oversight.
 */
const EXEMPT: Record<string, string> = {
    "module-sources/csv-import-export/api/export/route.ts":
        "Exporting every row is the entire purpose of the module; a page size would produce a truncated export.",
};

/** Filters that pin the query to one owner, so the row count is that owner's, not the site's. */
const NARROWING = /\b(id|userId|referrerId|orderId|ticketId|topicId|articleId|conversationId|sessionId|keyPrefix)\s*[:,]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

/** Strips block comments so a query quoted in a doc comment is not a finding. */

/** The whole call text from its opening paren, brackets balanced. */
export function callText(source: string, openParen: number): string {
    let depth = 0;
    for (let i = openParen; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") {
            depth--;
            if (depth === 0) return source.slice(openParen, i + 1);
        }
    }
    return source.slice(openParen);
}

export function isBounded(call: string): boolean {
    return /\btake\b\s*[:,]/.test(call) || NARROWING.test(call);
}

const files = SCANNED.flatMap((dir) => sourceFiles(path.join(root, dir)));

function unboundedListQueries(): string[] {
    const found: string[] = [];
    for (const file of files) {
        const rel = path.relative(root, file);
        if (rel in EXEMPT) continue;
        const source = stripComments(fs.readFileSync(file, "utf8"));
        for (const m of source.matchAll(/prisma\.(\w+)\s*\.findMany\s*\(/g)) {
            if (!GROWING.has(m[1])) continue;
            const call = callText(source, m.index + m[0].length - 1);
            if (isBounded(call)) continue;
            found.push(`${rel}: ${m[1]}.findMany`);
        }
    }
    return [...new Set(found)].sort();
}

describe("list queries", () => {
    it("scans the whole product", () => {
        expect(files.length).toBeGreaterThan(400);
    });

    it("reads no growing table without a ceiling", () => {
        expect(unboundedListQueries()).toEqual([]);
    });

    it("keeps every exemption pointed at a file that still exists, with a reason", () => {
        for (const [file, reason] of Object.entries(EXEMPT)) {
            expect(fs.existsSync(path.join(root, file)), `${file} is exempt but missing`).toBe(true);
            expect(reason.length, `${file} has no real reason`).toBeGreaterThan(40);
        }
    });
});

describe("the screens that were fixed", () => {
    const reads = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

    it("pages the gift codes rather than sending every one", () => {
        const route = reads("module-sources/store/api/gift-codes/route.ts");
        expect(route).toContain("skip: (page - 1) * perPage");
        expect(route).toContain("take: perPage");
        expect(route).toContain("prisma.giftCode.count()");
    });

    it("gives the gift code screen a way to reach the next page", () => {
        const page = reads("module-sources/store/pages/admin/gift-codes/page.tsx");
        expect(page).toContain("?page=${targetPage}");
        // Its own two chevrons became the shared pager, which carries first,
        // last, numbered pages and a box to type a page number into.
        expect(page).toContain("<Pagination");
        expect(page).toContain("pages={totalPages}");
    });

    it("pages the blog index and still shows the newest five in the sidebar", () => {
        const page = reads("module-sources/blog/pages/page.tsx");
        expect(page).toContain("skip: (page - 1) * PER_PAGE");
        expect(page).toContain("take: PER_PAGE");
        // The sidebar used to slice the current page, so page two listed page
        // two's articles as "recent".
        expect(page).not.toContain("articles.slice(0, 5)");
        expect(page).toContain("recent.map");
    });

    it("counts the admin article total from the groupBy, not from the rows on screen", () => {
        const page = reads("module-sources/blog/pages/admin/articles/page.tsx");
        expect(page).toContain("take: PER_PAGE");
        expect(page).not.toContain("{articles.length}</div>");
        expect(page).toContain("stats.reduce");
    });

    it("caps the block list the proxy walks in process on every request", () => {
        const blocks = reads("src/core/lib/ip-blocks.ts");
        expect(blocks).toContain("MAX_CACHED_BLOCKS");
    });
});

describe("the scanner itself", () => {
    it("counts a take as a ceiling", () => {
        expect(isBounded("({ take: 20 })")).toBe(true);
    });

    it("counts a per-owner filter as a ceiling", () => {
        expect(isBounded("({ where: { userId, isActive: true } })")).toBe(true);
        expect(isBounded("({ where: { userId: id } })")).toBe(true);
    });

    it("counts nothing else", () => {
        expect(isBounded('({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" } })')).toBe(false);
    });

    it("reads a whole call across nested brackets", () => {
        const src = 'prisma.user.findMany({ where: { a: fn(1, 2) } }); after';
        const call = callText(src, src.indexOf("(", src.indexOf("findMany")));
        expect(call.endsWith("})")).toBe(true);
        expect(call).not.toContain("after");
    });
});
