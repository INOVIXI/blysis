import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { bucketKeyFor, bucketFor } from "@/core/lib/module-api-limits";
import { matchApiRoute } from "@/core/lib/api-matcher";
import { ModuleApiRoutes } from "@/core/generated/module-registry";

/**
 * One handler, one budget, however many URLs point at it.
 *
 * A manifest declares `{ path, handler }` pairs and nothing stops it naming
 * one handler at two paths. Fifteen do: the store lists thirteen of its routes
 * both bare and under `/store/`, and `servers` and `member-profiles` each list
 * one twice. The dispatcher keyed its rate-limit bucket on a registry key
 * built from the path, so every alias opened a second budget and the ceiling
 * on those endpoints was twice what it read as.
 *
 * Measured on the demo before the fix: 140 requests to
 * `/api/v1/store/widget-stats` gave 120 served and 20 refused, 30 more to the
 * same path were all refused, and 30 to `/api/v1/widget-stats` from the same
 * caller were all served. Two of the aliased routes hand out value on request,
 * `gift-codes/redeem` and `chest/[id]`, and the dispatcher exists precisely so
 * that an endpoint cannot opt out of its limit.
 *
 * Aliasing is allowed; paying twice for it is not.
 */

const ROOT = process.cwd();

interface ManifestRoute {
    path: string;
    handler: string;
    method?: string;
    providerCallback?: boolean;
    rateLimit?: { maxRequests: number; windowMs: number };
}

function manifests(): { id: string; api: ManifestRoute[] }[] {
    const dir = path.join(ROOT, "module-sources");
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name, "module.json"))
        .filter((f) => fs.existsSync(f))
        .map((f) => JSON.parse(fs.readFileSync(f, "utf8")))
        .map((m) => ({ id: m.id as string, api: (m.api ?? []) as ManifestRoute[] }));
}

const normalizeHandler = (h: string) => (h ?? "").replace(/^\.?\//, "");

/** Every handler a manifest names more than once, with the paths naming it. */
function aliasedHandlers(): { module: string; handler: string; routes: ManifestRoute[] }[] {
    const out: { module: string; handler: string; routes: ManifestRoute[] }[] = [];
    for (const { id, api } of manifests()) {
        const byHandler = new Map<string, ManifestRoute[]>();
        for (const route of api) {
            const handler = normalizeHandler(route.handler);
            if (!handler) continue;
            byHandler.set(handler, [...(byHandler.get(handler) ?? []), route]);
        }
        for (const [handler, routes] of byHandler) {
            if (routes.length > 1) out.push({ module: id, handler, routes });
        }
    }
    return out;
}

describe("bucketKeyFor", () => {
    it("gives two paths on one handler the same key", () => {
        const a = { module: "store", handler: "api/widget-stats/route.ts", key: "store:api:/widget-stats" };
        const b = { module: "store", handler: "api/widget-stats/route.ts", key: "store:api:/store/widget-stats" };
        expect(bucketKeyFor(a)).toBe(bucketKeyFor(b));
    });

    it("keeps two different handlers apart", () => {
        const a = { module: "store", handler: "api/widget-stats/route.ts", key: "store:api:/widget-stats" };
        const b = { module: "store", handler: "api/gift-codes/redeem/route.ts", key: "store:api:/gift-codes/redeem" };
        expect(bucketKeyFor(a)).not.toBe(bucketKeyFor(b));
    });

    it("does not let two modules share a bucket by naming their handlers alike", () => {
        const a = { module: "store", handler: "api/route.ts", key: "store:api:/store" };
        const b = { module: "vote", handler: "api/route.ts", key: "vote:api:/vote" };
        expect(bucketKeyFor(a)).not.toBe(bucketKeyFor(b));
    });

    it("falls back to the key when a route table predates the handler field", () => {
        const stale = { module: "store", key: "store:api:/widget-stats" };
        expect(bucketKeyFor(stale)).toBe("store:api:/widget-stats");
    });
});

describe("the generated route table", () => {
    it("carries a handler for every route, so no route falls back", () => {
        const missing = ModuleApiRoutes.filter((r) => !r.handler).map((r) => r.key);
        expect(missing).toEqual([]);
    });

    it("resolves both spellings of an aliased route to one bucket", () => {
        const aliased = aliasedHandlers();
        expect(aliased.length).toBeGreaterThan(0); // the condition this guards

        // matchApiRoute reads the generated table, which holds installed
        // modules only, so routing is asserted for those and the manifest
        // invariants below cover every module in the repository.
        const installed = new Set(ModuleApiRoutes.map((r) => r.path));
        let checked = 0;

        for (const { module, routes } of aliased) {
            // Concrete paths only: matchApiRoute takes a real request's segments.
            const concrete = routes.filter((r) => !r.path.includes("[") && installed.has(r.path));
            if (concrete.length < 2) continue;
            const keys = new Set(
                concrete.map((r) => {
                    const match = matchApiRoute(r.path.replace(/^\//, "").split("/"));
                    expect(match, `${module} ${r.path} does not route`).not.toBeNull();
                    return bucketKeyFor(match!);
                }),
            );
            expect([...keys], `${module} ${concrete.map((r) => r.path).join(" / ")}`).toHaveLength(1);
            checked++;
        }
        expect(checked, "no installed module has an aliased route to check").toBeGreaterThan(0);
    });
});

describe("the dispatcher", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/app/api/v1/[...path]/route.ts"), "utf8");

    it("spends budget against the handler, not the URL", () => {
        expect(source).toContain("bucketKeyFor(match)");
        expect(source).not.toMatch(/module-api:\$\{match\.key\}/);
    });
});

describe("aliased declarations", () => {
    it("agree on method, rateLimit and providerCallback", () => {
        // They share one bucket now, so a loose spelling of a route another
        // spelling asked to tighten would hand back the ceiling it removed.
        const shape = (r: ManifestRoute) =>
            JSON.stringify({
                method: r.method ?? "ALL",
                providerCallback: r.providerCallback ?? false,
                rateLimit: r.rateLimit ?? null,
            });
        const disagreeing = aliasedHandlers()
            .filter(({ routes }) => new Set(routes.map(shape)).size > 1)
            .map(({ module, handler, routes }) => `${module}: ${handler} at ${routes.map((r) => r.path).join(", ")}`);
        expect(disagreeing).toEqual([]);
    });

    it("resolve to the same bucket size", () => {
        for (const { module, routes } of aliasedHandlers()) {
            const buckets = new Set(routes.map((r) => JSON.stringify(bucketFor(r))));
            expect([...buckets], module).toHaveLength(1);
        }
    });
});

describe("no two modules claim one URL", () => {
    it("leaves nothing shadowed", () => {
        // matchApiRoute takes the first entry that matches, and a second
        // module declaring a path the first already declared would simply
        // never be reached - with nothing in the build saying so.
        const seen = new Map<string, string>();
        const clashes: string[] = [];
        for (const { id, api } of manifests()) {
            for (const route of api) {
                const owner = seen.get(route.path);
                if (owner && owner !== id) clashes.push(`${route.path}: ${owner} and ${id}`);
                else seen.set(route.path, id);
            }
        }
        expect(clashes).toEqual([]);
    });
});
