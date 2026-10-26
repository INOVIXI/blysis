import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A search result is a way into content, not a lesser view of it. Whatever
 * test the public endpoint applies before it will show a row, the module's
 * search provider has to apply before it will name one - otherwise the title,
 * the excerpt and the link leak past exactly the switch that was supposed to
 * hold them back.
 *
 * Three of the four shipped providers had drifted from the endpoints they
 * link to:
 *
 * - forum searched every topic regardless of `moderationState`, so a topic
 *   still queued for a moderator was findable by anyone, excerpt and all,
 *   while `/api/v1/forum/topics` and the single-topic endpoint both hide it.
 * - help-center searched inactive articles, so clearing `isActive` - the way
 *   an article is taken down - left it readable to anyone who searched a
 *   phrase from it.
 * - blog checked `status = 'PUBLISHED'` but neither date, so an article with
 *   a future `publishedAt` or a leftover `publishAt` from a schedule was
 *   findable before its own publication.
 *
 * Each provider runs two queries: a Postgres full-text path and an ILIKE
 * fallback for an install whose GIN index is not built yet. Both are checked
 * here, because a rule applied to one path only is a rule that holds until
 * the index is missing.
 */

const rawCalls: string[] = [];
const findManyCalls: { model: string; args: Record<string, unknown> }[] = [];
let rawFails = false;

function delegate(model: string) {
    return {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
            findManyCalls.push({ model, args });
            return [];
        }),
    };
}

vi.mock("@/core/sdk/auth", () => ({ auth: async () => null }));

vi.mock("@/core/sdk/server", async () => {
    // The real SQL, so a provider builds its query as it does on a site.
    const { searchMatches, searchRank } = await import("@/core/lib/search-text");
    return {
        searchMatches,
        searchRank,
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        prisma: {
            $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
                rawCalls.push(strings.join(" ? "));
                if (rawFails) throw new Error("relation index not ready");
                return [];
            }),
            blogArticle: delegate("blogArticle"),
            forumTopic: delegate("forumTopic"),
            // Read by the forum's visibility helper before it reads topics: a
            // site with no matrix hides nothing, which is what these answer.
            forumCategory: delegate("forumCategory"),
            forumCategoryPermission: delegate("forumCategoryPermission"),
            helpArticle: delegate("helpArticle"),
            product: delegate("product"),
        },
        // `allowGuestView` is the forum's other visibility rule, and its provider
        // now consults it before it queries anything. Granting it here is what
        // lets these tests reach the rule they are actually about - the one a
        // moderator applies. The rule itself has its own tests.
        moduleSettings: vi.fn(async () => ({ enableSearch: true, allowGuestView: true })),
    };
});

/**
 * What the public endpoint of the same module tests before it shows a row,
 * spelled once for the SQL path and once for the Prisma path.
 */
type Handler = { default: (q: string) => Promise<unknown[]> };

/**
 * Loaded through `import.meta.glob` rather than a static import on purpose.
 * `module-sources/` is not part of the tsc program - an uninstalled module's
 * models are not in the merged Prisma client, so a static import here would
 * fail `npm run typecheck` for every module the machine has not installed.
 */
// The call has to stay literal for Vite to rewrite it; the project's tsconfig
// does not pull in vite/client, so the result is typed here instead.
const searchHandlers = import.meta.glob(
    "../../module-sources/*/search/handler.ts",
) as Record<string, () => Promise<Handler>>;
const sitemapBuilders = import.meta.glob(
    "../../module-sources/*/seo/sitemap.ts",
) as Record<string, () => Promise<{ default: () => Promise<unknown[]> }>>;

function load<T>(glob: Record<string, () => Promise<T>>, module: string): () => Promise<T> {
    const key = Object.keys(glob).find((k) => k.includes(`/${module}/`));
    if (!key) throw new Error(`no entry for ${module}`);
    return glob[key];
}

const PROVIDERS = [
    {
        module: "blog",
        model: "blogArticle",
        load: load(searchHandlers, "blog"),
        sql: [/status\s*=\s*'PUBLISHED'/, /"publishedAt"\s*<=\s*NOW\(\)/, /"publishAt"\s+IS\s+NULL/],
        where: (json: string) => [
            expect(json).toContain('"status":"PUBLISHED"'),
            expect(json).toContain('"publishedAt"'),
            expect(json).toContain('"publishAt"'),
        ],
        reason: "an article is visible when it is published and both of its dates have passed",
    },
    {
        module: "forum",
        model: "forumTopic",
        load: load(searchHandlers, "forum"),
        sql: [/"moderationState"\s*=\s*'APPROVED'/],
        where: (json: string) => [expect(json).toContain('"moderationState":"APPROVED"')],
        reason: "a topic is visible once a moderator has approved it",
    },
    {
        module: "help-center",
        model: "helpArticle",
        load: load(searchHandlers, "help-center"),
        sql: [/"isActive"\s*=\s*true/],
        where: (json: string) => [expect(json).toContain('"isActive":true')],
        reason: "clearing isActive is how a help article is taken down",
    },
    {
        module: "store",
        model: "product",
        load: load(searchHandlers, "store"),
        sql: [/"isActive"\s*=\s*true/],
        where: (json: string) => [expect(json).toContain('"isActive":true')],
        reason: "an inactive product is off the shelf, not merely unlinked",
    },
] as const;

describe("a search provider shows only what its public page would", () => {
    beforeEach(() => {
        rawCalls.length = 0;
        findManyCalls.length = 0;
        rawFails = false;
    });

    it("covers every provider that ships a handler", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const root = path.resolve(import.meta.dirname, "../..");
        const shipped = fs
            .readdirSync(path.join(root, "module-sources"), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .filter((e) => fs.existsSync(path.join(root, "module-sources", e.name, "search", "handler.ts")))
            .map((e) => e.name)
            .sort();
        expect(shipped).toEqual([...PROVIDERS].map((p) => p.module).sort());
    });

    for (const provider of PROVIDERS) {
        it(`${provider.module} narrows its full-text query: ${provider.reason}`, async () => {
            const { default: search } = await provider.load();
            await search("lantern");
            expect(rawCalls, `${provider.module} ran no full-text query`).toHaveLength(1);
            for (const pattern of provider.sql) {
                expect(rawCalls[0], `${provider.module} full-text path is missing ${pattern}`).toMatch(pattern);
            }
        });

        it(`${provider.module} narrows its fallback query too`, async () => {
            rawFails = true;
            const { default: search } = await provider.load();
            await search("lantern");
            const call = findManyCalls.find((c) => c.model === provider.model);
            expect(call, `${provider.module} never reached its ILIKE fallback`).toBeDefined();
            provider.where(JSON.stringify(call!.args.where));
        });

        it(`${provider.module} asks nothing of a query too short to mean anything`, async () => {
            const { default: search } = await provider.load();
            expect(await search("a")).toEqual([]);
            expect(await search("")).toEqual([]);
            expect(rawCalls, `${provider.module} queried the database for a one-character search`).toHaveLength(0);
        });
    }
});

/**
 * A sitemap is the most public read path a module has: it hands a crawler the
 * list of URLs worth fetching. The forum's listed every topic whatever its
 * `moderationState`, so a topic still queued for a moderator was announced to
 * search engines while its own page answers 404 to everyone but an admin. The
 * blog's tested `publishedAt` but not the `publishAt` a schedule leaves
 * behind.
 */
const SITEMAPS = [
    {
        module: "blog",
        model: "blogArticle",
        load: load(sitemapBuilders, "blog"),
        expect: (json: string) => {
            expect(json).toContain('"status":"PUBLISHED"');
            expect(json).toContain('"publishedAt"');
            expect(json).toContain('"publishAt"');
        },
        reason: "an article is announced once it is published and both dates have passed",
    },
    {
        module: "forum",
        model: "forumTopic",
        load: load(sitemapBuilders, "forum"),
        expect: (json: string) => {
            expect(json).toContain('"moderationState":"APPROVED"');
        },
        reason: "a topic is announced once a moderator has approved it",
    },
    {
        module: "help-center",
        model: "helpArticle",
        load: load(sitemapBuilders, "help-center"),
        expect: (json: string) => {
            expect(json).toContain('"isActive":true');
        },
        reason: "an article taken down is not announced",
    },
    {
        module: "store",
        model: "product",
        load: load(sitemapBuilders, "store"),
        expect: (json: string) => {
            expect(json).toContain('"isActive":true');
        },
        reason: "a product taken off the shelf is not announced",
    },
] as const;

describe("a sitemap announces only what its public page would", () => {
    beforeEach(() => {
        rawCalls.length = 0;
        findManyCalls.length = 0;
        rawFails = false;
    });

    it("covers every sitemap contributor that reads rows", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const root = path.resolve(import.meta.dirname, "../..");
        const shipped = fs
            .readdirSync(path.join(root, "module-sources"), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .filter((e) => {
                const file = path.join(root, "module-sources", e.name, "seo", "sitemap.ts");
                // A contributor that names a static page has no rows to hide.
                return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("prisma.");
            })
            .map((e) => e.name)
            .sort();
        expect(shipped).toEqual([...SITEMAPS].map((s) => s.module).sort());
    });

    for (const sitemap of SITEMAPS) {
        it(`${sitemap.module} narrows what it announces: ${sitemap.reason}`, async () => {
            const { default: build } = await sitemap.load();
            await build();
            const call = findManyCalls.find((c) => c.model === sitemap.model);
            expect(call, `${sitemap.module} read no rows`).toBeDefined();
            sitemap.expect(JSON.stringify(call!.args.where));
        });
    }
});
