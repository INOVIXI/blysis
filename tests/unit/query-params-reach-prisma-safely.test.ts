import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { intParam, enumParam } from "../../src/core/lib/api-query";

/**
 * Prisma checks its own arguments before it builds any SQL, and it reports a
 * bad one by throwing. Three shapes of query string reach that check straight
 * from the URL:
 *
 *   ?page=abc     -> skip: NaN            -> PrismaClientValidationError
 *   ?page=-5      -> skip: negative       -> PrismaClientUnknownRequestError
 *   ?status=nope  -> where on an enum     -> PrismaClientValidationError
 *
 * An uncaught throw in a route handler is a 500. All three are the caller's
 * mistake, so all three should be a 400 or a clamp, and none of them should
 * land in the log as a server error. `GET /api/v1/tickets?status=x` was
 * reachable by any logged-in account.
 *
 * The two checks below are the rule: a number out of a query string is clamped
 * NaN-safely before it becomes `skip` or `take`, and an enum column is never
 * filtered on a raw parameter.
 */

const ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------- schema

type EnumColumns = Map<string, Set<string>>; // prisma delegate -> enum field names

function readSchemas(): string[] {
    const paths = [path.join(ROOT, "prisma/schema.prisma")];
    const sources = path.join(ROOT, "module-sources");
    for (const entry of fs.readdirSync(sources, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const schema = path.join(sources, entry.name, "schema.prisma");
        if (fs.existsSync(schema)) paths.push(schema);
    }
    return paths.map((p) => fs.readFileSync(p, "utf8"));
}

export function enumColumns(schemas: string[]): EnumColumns {
    const enums = new Set<string>();
    for (const s of schemas) for (const m of s.matchAll(/^enum\s+(\w+)/gm)) enums.add(m[1]);
    const columns: EnumColumns = new Map();
    for (const s of schemas) {
        for (const model of s.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
            const delegate = model[1][0].toLowerCase() + model[1].slice(1);
            for (const field of model[2].matchAll(/^\s*(\w+)\s+(\w+)/gm)) {
                if (!enums.has(field[2])) continue;
                if (!columns.has(delegate)) columns.set(delegate, new Set());
                columns.get(delegate)!.add(field[1]);
            }
        }
    }
    return columns;
}

// ---------------------------------------------------------------- routes

const FROM_QUERY = /(?:const|let)\s+(\w+)\s*=\s*([^;]*searchParams\.get\([^;]*)/g;
const READS = /prisma\.(\w+)\.(findMany|findFirst|count|aggregate|groupBy)\b/g;
const WHERE_ASSIGN = /where\.(\w+)\s*=\s*(\w+)\s*;/g;
const PAGINATE = /\b(skip|take)\s*:\s*([^,\n}]+)/g;
const NAN_SAFE = /intParam|\|\|\s*-?\d|\?\?\s*-?\d|Number\.isFinite|isNaN|Number\.isInteger|z\.coerce/;

/** Names bound from a query parameter, with the expression that bound them. */
export function queryBindings(source: string): Map<string, string> {
    const bound = new Map<string, string>();
    for (const m of source.matchAll(FROM_QUERY)) {
        if (!bound.has(m[1])) bound.set(m[1], m[2].replace(/\s+/g, " "));
    }
    return bound;
}

/** Enum columns filtered straight from a query parameter. */
export function rawEnumFilters(source: string, columns: EnumColumns): string[] {
    const bound = queryBindings(source);
    const models = new Set([...source.matchAll(READS)].map((m) => m[1]));
    const found: string[] = [];
    for (const m of source.matchAll(WHERE_ASSIGN)) {
        const [, field, value] = m;
        const binding = bound.get(value);
        if (binding === undefined || binding.includes("enumParam")) continue;
        for (const model of models) {
            if (columns.get(model)?.has(field)) found.push(`prisma.${model}.where.${field} = ${value}`);
        }
    }
    return found;
}

/** skip/take values that come from a query parameter and can still be NaN. */
export function unsafePagination(source: string): string[] {
    const bound = queryBindings(source);
    const found: string[] = [];
    for (const m of source.matchAll(PAGINATE)) {
        const expression = m[2].trim();
        for (const name of new Set(expression.match(/[A-Za-z_]\w*/g) ?? [])) {
            const binding = bound.get(name);
            if (binding === undefined || NAN_SAFE.test(binding)) continue;
            found.push(`${m[1]}: ${expression} (${name} = ${binding})`);
        }
    }
    return found;
}

function routeFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === "route.ts") out.push(full);
        }
    };
    for (const base of ["src/app/api", "module-sources"]) walk(path.join(ROOT, base));
    return out;
}

describe("query parameters reach Prisma in a shape it accepts", () => {
    const columns = enumColumns(readSchemas());
    const routes = routeFiles().map((file) => ({
        file: path.relative(ROOT, file),
        source: fs.readFileSync(file, "utf8"),
    }));

    it("knows which columns are enums and which routes to read", () => {
        /*
         * A ticket's status stopped being a database type: which states a
         * desk has is the operator's, and adding a value to an enum is a
         * migration rather than a setting. So the hazard this whole file is
         * about - a raw query parameter reaching a column Postgres will
         * refuse - no longer applies to it, and the route checks the value
         * against the desk's own rows instead.
         */
        expect(columns.get("ticket")?.has("status") ?? false).toBe(false);
        expect(columns.get("blogArticle")?.has("status")).toBe(true);
        expect(columns.get("suggestion")?.has("status") ?? false).toBe(false);
        expect(routes.length).toBeGreaterThan(100);
    });

    it("never filters an enum column on a raw query parameter", () => {
        const bad = routes.flatMap((r) => rawEnumFilters(r.source, columns).map((f) => `${r.file}: ${f}`));
        expect(bad.join("\n")).toBe("");
    });

    it("never lets a query parameter reach skip or take as NaN", () => {
        const bad = routes.flatMap((r) => unsafePagination(r.source).map((f) => `${r.file}: ${f}`));
        expect(bad.join("\n")).toBe("");
    });

    it("routes the enum filter through enumParam", () => {
        for (const file of [
            "module-sources/blog/api/articles/route.ts",
        ]) {
            const source = fs.readFileSync(path.join(ROOT, file), "utf8");
            expect(source, file).toContain("enumParam(searchParams, \"status\"");
            expect(source, file).toContain("instanceof NextResponse) return status");
        }
    });

    it("keeps each status list in one place", () => {
        const blog = fs.readFileSync(path.join(ROOT, "module-sources/blog/lib/validations.ts"), "utf8");
        expect(blog).toContain("z.enum(ARTICLE_STATUSES)");
        // A ticket's states are rows, so the list cannot live in a schema at
        // all: the route checks what was asked for against what the desk
        // has, which is the one place it can be checked against.
        const ticketRoute = fs.readFileSync(
            path.join(ROOT, "module-sources/tickets/api/tickets/route.ts"), "utf8");
        expect(ticketRoute).toContain("readTicketStates");
        expect(ticketRoute).toContain("unknown_status");
    });
});

describe("intParam", () => {
    const q = (search: string) => new URLSearchParams(search);

    it("returns the value when it is a number in range", () => {
        expect(intParam(q("page=3"), "page", { fallback: 1 })).toBe(3);
    });

    it("falls back rather than returning NaN", () => {
        for (const search of ["page=abc", "page=", "", "page=%20", "page=null"]) {
            expect(intParam(q(search), "page", { fallback: 1 }), search).toBe(1);
        }
    });

    it("clamps below and above", () => {
        expect(intParam(q("page=-5"), "page", { fallback: 1, min: 1 })).toBe(1);
        expect(intParam(q("perPage=100000"), "perPage", { fallback: 24, min: 1, max: 100 })).toBe(100);
        expect(intParam(q("perPage=0"), "perPage", { fallback: 24, min: 1, max: 100 })).toBe(1);
    });

    it("clamps the fallback too, so a bad default cannot leak through", () => {
        expect(intParam(q(""), "page", { fallback: -10, min: 1, max: 50 })).toBe(1);
        expect(intParam(q(""), "page", { fallback: 900, min: 1, max: 50 })).toBe(50);
    });

    it("takes the first value when a parameter is repeated", () => {
        expect(intParam(q("page=2&page=9"), "page", { fallback: 1 })).toBe(2);
    });

    it("ignores a trailing suffix the way parseInt does, but never returns NaN", () => {
        expect(intParam(q("page=3x"), "page", { fallback: 1 })).toBe(3);
        expect(intParam(q("page=x3"), "page", { fallback: 7, min: 1 })).toBe(7);
    });
});

describe("enumParam", () => {
    const STATUSES = ["OPEN", "CLOSED"] as const;
    const q = (search: string) => new URLSearchParams(search);

    it("returns the value when it is one of the allowed ones", () => {
        expect(enumParam(q("status=OPEN"), "status", STATUSES)).toBe("OPEN");
    });

    it("returns null when the caller did not ask for one", () => {
        expect(enumParam(q(""), "status", STATUSES)).toBeNull();
        expect(enumParam(q("status="), "status", STATUSES)).toBeNull();
    });

    it("answers 400 for a value the enum does not have", async () => {
        const result = enumParam(q("status=nope"), "status", STATUSES);
        expect(result).toBeInstanceOf(NextResponse);
        const response = result as NextResponse;
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.code).toBe("invalid_query_param");
        expect(body.allowed).toEqual(["OPEN", "CLOSED"]);
    });

    it("is case sensitive, because the enum is", () => {
        expect(enumParam(q("status=open"), "status", STATUSES)).toBeInstanceOf(NextResponse);
    });

    it("does not accept a value inherited from Object.prototype", () => {
        expect(enumParam(q("status=toString"), "status", STATUSES)).toBeInstanceOf(NextResponse);
    });
});

describe("the checks themselves", () => {
    const columns: EnumColumns = new Map([["ticket", new Set(["status"])]]);
    const rawFilter = `
const status = searchParams.get("status");
const where: Record<string, unknown> = {};
where.status = status;
await prisma.ticket.findMany({ where });
`;
    const guarded = `
const status = enumParam(searchParams, "status", TICKET_STATUSES);
if (status instanceof NextResponse) return status;
where.status = status;
await prisma.ticket.findMany({ where });
`;

    it("catches an enum filtered from a raw parameter", () => {
        expect(rawEnumFilters(rawFilter, columns)).toEqual(["prisma.ticket.where.status = status"]);
    });

    it("accepts the same filter once it goes through enumParam", () => {
        expect(rawEnumFilters(guarded, columns)).toEqual([]);
    });

    it("ignores a column that is not an enum", () => {
        expect(rawEnumFilters(rawFilter, new Map([["ticket", new Set(["priority"])]]))).toEqual([]);
    });

    it("catches an unclamped page and accepts a clamped one", () => {
        const unsafe = `const page = parseInt(searchParams.get("page") || "1");\nprisma.a.findMany({ skip: (page - 1) * 24 });`;
        const safe = `const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);\nprisma.a.findMany({ skip: (page - 1) * 24 });`;
        const helper = `const page = intParam(searchParams, "page", { fallback: 1, min: 1 });\nprisma.a.findMany({ skip: (page - 1) * 24 });`;
        expect(unsafePagination(unsafe)).toHaveLength(1);
        expect(unsafePagination(safe)).toEqual([]);
        expect(unsafePagination(helper)).toEqual([]);
    });

    it("leaves a constant skip alone", () => {
        expect(unsafePagination(`prisma.a.findMany({ skip: 0, take: 10 });`)).toEqual([]);
    });
});
