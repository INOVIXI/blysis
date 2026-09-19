import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A `where` on a column with no index is a sequential scan, and on the tables
 * that grow with the site that cost arrives later, on someone else's data.
 *
 * The moderation queue was the clearest case. Opening the admin moderation
 * screen calls `count({ where: { moderationState: "PENDING" } })` once per
 * provider, and none of the four content tables it counts - blog comments,
 * forum posts, forum topics, suggestions - had an index on that column. On a
 * site with a million forum posts and three pending ones, that is four full
 * scans to render a badge. `Announcement` had no index at all, and its public
 * banner query runs on every page render; the scheduled-publish crons scan
 * `publishAt` on every tick; the stats screens scan a date window over orders,
 * tickets, topics, articles and users.
 *
 * The rule below is the scan that found them, kept: a filter on a model whose
 * rows accumulate must name an indexed column. What it cannot decide is when
 * an index is not worth its write cost, so the judgement calls are listed by
 * name with the reason. A new filter on an unindexed growing column fails
 * here until someone adds the index or adds the exemption and says why.
 */

const ROOT = path.resolve(__dirname, "../..");

/**
 * Filters we have looked at and left unindexed, with why.
 *
 * `prisma/schema.prisma` is generated; the source of truth for core models is
 * `schema.core.prisma`, which is what this reads.
 */
const EXEMPT: Record<string, string> = {
    "UserSession.isRevoked": "always paired with userId or expiresAt, both indexed",
    "UserSession.lastActiveAt": "always paired with tokenId, which is unique, so the planner has one row before this condition is applied",
    "Trophy.isActive": "a curated list an admin writes, tens of rows at most",
    "Referral.status": "one row per referral, and the admin screen reads them all anyway",
    "HelpArticle.isActive": "a curated list, and the sitemap build is not a request path",
    "GiftCode.isRedeemed": "paired with the unique code on the redeem path",
    "Download.isActive": "a curated list an admin writes, and the page shows all of it",
    "BlogComment.isApproved": "always paired with articleId, which is indexed and selective",
    "ApiKey.isActive": "paired with keyPrefix, which is indexed",
    "ActivityLog.metadata": "a JSON path filter, which a plain btree index does not serve",
    "OrderItem.order": "a relation filter, which this scan cannot see through: the join uses OrderItem.orderId and the conditions are Order.status and Order.createdAt, all three indexed",
    "User.loginSessions": "a relation filter, which this scan cannot see through: the join uses UserSession.userId and the conditions are isRevoked and expiresAt, all indexed",
    "User.isBanned": "counting the administrators who can still sign in, which runs once per ban, demotion or deletion - an admin action, not a request path, and the row it protects against losing is the last one",
    "User.isDeleted": "the same count, for the same reason",
    "User.role": "the same count: a relation filter this scan cannot see through, joining on User.roleId to a table with three rows in it",
};

/** Models whose row count grows with what users do. */
const GROWING = new Set([
    "message", "conversation", "conversationParticipant", "notification", "revision",
    "activityLog", "activityFeedItem", "order", "orderItem", "payment", "cartItem",
    "blogComment", "blogArticle", "forumPost", "forumTopic", "ticket", "ticketMessage",
    "suggestion", "suggestionVote", "punishment", "vote", "voteLog", "creditTransaction",
    "emailJob", "userWarning", "userSession", "auditLog", "webhookLog", "formSubmission",
    "download", "licenseKey", "licenseActivation", "giftCode", "announcement", "user",
    "mediaItem", "apiKey", "ipBlock", "helpArticle", "staffApplication", "trophy",
    "userTrophy", "referral",
]);

interface ModelInfo { fields: Set<string>; indexed: Set<string>; name: string }

function schemaFiles(): string[] {
    const files = [path.join(ROOT, "prisma/schema.core.prisma")];
    const sources = path.join(ROOT, "module-sources");
    for (const entry of fs.readdirSync(sources, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const schema = path.join(sources, entry.name, "schema.prisma");
        if (fs.existsSync(schema)) files.push(schema);
    }
    return files;
}

export function readModels(schemas: string[]): Map<string, ModelInfo> {
    const models = new Map<string, ModelInfo>();
    for (const source of schemas) {
        for (const m of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
            const name = m[1];
            const delegate = name[0].toLowerCase() + name.slice(1);
            const info = models.get(delegate) ?? { fields: new Set(), indexed: new Set(), name };
            for (const line of m[2].split("\n")) {
                const field = line.trim().match(/^(\w+)\s+\w+/);
                if (field && !field[1].startsWith("@@")) info.fields.add(field[1]);
                if (/@(id|unique)\b/.test(line) && field) info.indexed.add(field[1]);
                for (const idx of line.matchAll(/@@(?:index|unique)\(\[([^\]]+)\]/g)) {
                    for (const part of idx[1].split(",")) info.indexed.add(part.trim());
                }
            }
            models.set(delegate, info);
        }
    }
    return models;
}

/** The balanced text of the call that starts at `from`. */
function callText(source: string, from: number): string {
    const open = source.indexOf("(", from);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const c = source[i];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
            depth--;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    return source.slice(open);
}

/** The top-level keys of the first `where:` object in a call. */
export function whereKeys(call: string): string[] {
    const at = call.search(/\bwhere:\s*\{/);
    if (at === -1) return [];
    const open = call.indexOf("{", at);
    let depth = 0;
    let inner = "";
    for (let i = open; i < call.length; i++) {
        const c = call[i];
        if (c === "{" || c === "[" || c === "(") depth++;
        else if (c === "}" || c === "]" || c === ")") {
            depth--;
            if (depth === 0) break;
        }
        if (depth === 1) inner += c;
    }
    return [...inner.matchAll(/(?:^|[,{])\s*(\w+)\s*:/g)].map((m) => m[1]);
}

export function unindexedFilters(
    files: { file: string; source: string }[],
    models: Map<string, ModelInfo>,
): string[] {
    const found = new Set<string>();
    const READ = /prisma\.(\w+)\.(findMany|findFirst|count|aggregate|groupBy|updateMany|deleteMany)\s*\(/g;
    for (const { source } of files) {
        for (const m of source.matchAll(READ)) {
            const delegate = m[1];
            const info = models.get(delegate);
            if (!info || !GROWING.has(delegate)) continue;
            for (const key of whereKeys(callText(source, m.index))) {
                if (!info.fields.has(key)) continue;
                if (info.indexed.has(key)) continue;
                found.add(`${info.name}.${key}`);
            }
        }
    }
    return [...found].sort();
}

function sourceFiles(): { file: string; source: string }[] {
    const out: { file: string; source: string }[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "generated") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) {
                out.push({ file: path.relative(ROOT, full), source: fs.readFileSync(full, "utf8") });
            }
        }
    };
    for (const base of ["src/app", "src/core", "module-sources"]) walk(path.join(ROOT, base));
    return out;
}

describe("filters on tables that grow", () => {
    const models = readModels(schemaFiles().map((f) => fs.readFileSync(f, "utf8")));
    const files = sourceFiles();

    it("reads the schemas and the call sites", () => {
        expect(models.size).toBeGreaterThan(80);
        expect(files.length).toBeGreaterThan(400);
        expect(models.get("forumPost")?.fields.has("moderationState")).toBe(true);
    });

    it("names an indexed column, or an exemption with a reason", () => {
        const unindexed = unindexedFilters(files, models);
        const unexplained = unindexed.filter((f) => !(f in EXEMPT));
        expect(unexplained).toEqual([]);
    });

    it("keeps the exemption list honest", () => {
        // An exemption for a filter nobody writes any more is dead weight.
        const unindexed = new Set(unindexedFilters(files, models));
        const stale = Object.keys(EXEMPT).filter((f) => !unindexed.has(f));
        expect(stale).toEqual([]);
        for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(20);
    });

    it("indexes the column the moderation queue counts on, in every provider's table", () => {
        for (const model of ["blogComment", "forumPost", "forumTopic", "suggestion"]) {
            expect(models.get(model)?.indexed.has("moderationState"), model).toBe(true);
        }
    });

    it("indexes what the scheduled-publish crons scan", () => {
        expect(models.get("announcement")?.indexed.has("publishAt")).toBe(true);
        expect(models.get("blogArticle")?.indexed.has("publishAt")).toBe(true);
    });

    it("indexes the date windows the stats screens read", () => {
        for (const model of ["order", "ticket", "forumTopic", "blogArticle", "user"]) {
            expect(models.get(model)?.indexed.has("createdAt"), model).toBe(true);
        }
    });
});

describe("counting unread messages", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/app/api/v1/messages/route.ts"), "utf8");

    it("counts in the database rather than reading every message", () => {
        // The cutoff is per conversation, so this used to read every inbound
        // message the user had ever received and bucket them in memory: O(all
        // of their messages) for a number that is almost always small.
        expect(source).toContain("prisma.message.groupBy");
        expect(source).not.toMatch(/prisma\.message\.findMany/);
    });

    it("still applies each conversation's own cutoff", () => {
        expect(source).toContain("p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}");
        expect(source).toContain('authorId: { not: userId }');
    });
});

describe("the scan itself", () => {
    const models = readModels([
        `model Thing {
  id String @id
  state String
  topicId String
  @@index([topicId])
}`,
    ]);

    it("reads a field list and an index list off a model", () => {
        expect(models.get("thing")?.fields.has("state")).toBe(true);
        expect(models.get("thing")?.indexed.has("topicId")).toBe(true);
        expect(models.get("thing")?.indexed.has("id")).toBe(true);
    });

    it("pulls the top-level keys out of a where, ignoring nested ones", () => {
        expect(whereKeys("({ where: { state: 'x', author: { name: 'y' } }, take: 1 })"))
            .toEqual(["state", "author"]);
    });

    it("says nothing about a model that does not grow", () => {
        const files = [{ file: "a.ts", source: "prisma.thing.findMany({ where: { state: 'x' } })" }];
        expect(unindexedFilters(files, models)).toEqual([]);
    });
});
