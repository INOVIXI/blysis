import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prismaErrorResponse, prismaErrorOrThrow } from "@/core/lib/prisma-errors";
import { relativePath } from "./source-text";

/**
 * A row that is not there is a 404, not a 500.
 *
 * Prisma throws `P2025` for an update or delete whose id matches nothing,
 * `P2002` for a unique column that is already taken, `P2003` for a foreign key
 * pointing at nothing. A handler that does not catch hands the throw upwards,
 * and the module API dispatcher answered every one of them with a flat 500 -
 * so deleting an id another admin had just deleted, or saving a slug someone
 * else had taken, both read as "the server broke". Twenty-eight mutating
 * handlers had no catch and no prior existence check.
 *
 * The dispatcher maps them now. Core's own routes have no dispatcher, so each
 * one either catches, checks first, or is listed below with its reason.
 */

const ROOT = process.cwd();

/** Handlers of a route file, split by the verb that opens each one. */
export function handlers(source: string): { verb: string; body: string }[] {
    const found = [...source.matchAll(/export\s+async\s+function\s+(GET|HEAD|POST|PATCH|PUT|DELETE)\s*\(/g)];
    return found.map((match, i) => ({
        verb: match[1],
        body: source.slice(match.index!, found[i + 1]?.index ?? source.length),
    }));
}

/** Unguarded `prisma.<model>.update|delete` calls in a mutating handler. */
export function unguardedWrites(source: string): string[] {
    const out: string[] = [];
    for (const { verb, body } of handlers(source)) {
        if (verb === "GET" || verb === "HEAD") continue;
        for (const call of body.matchAll(/prisma\.(\w+)\.(update|delete)\(/g)) {
            const before = body.slice(0, call.index!);
            const inTry = (before.match(/try\s*\{/g) ?? []).length > (before.match(/\}\s*catch/g) ?? []).length;
            const checkedFirst = new RegExp(`prisma\\.${call[1]}\\.find(Unique|First)\\(`).test(before);
            if (!inTry && !checkedFirst) out.push(`${verb} ${call[1]}.${call[2]}`);
        }
    }
    return out;
}

/**
 * Core routes that write without catching, each for a reason. A module route
 * needs no entry: its dispatcher applies the mapping to whatever it throws.
 */
const GUARDED_ELSEWHERE: Record<string, string> = {
    "src/app/api/v1/messages/[conversationId]/route.ts":
        "The conversation is established by the participation lookup above the write: a caller who is not a participant is refused before the update runs.",
};

function routeFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

describe("the Prisma error mapper", () => {
    it("names a missing row a 404", () => {
        expect(prismaErrorResponse({ code: "P2025" })).toEqual({ status: 404, error: "Not found", code: "P2025" });
    });

    it("names a taken unique value a 409", () => {
        expect(prismaErrorResponse({ code: "P2002" })?.status).toBe(409);
    });

    it("names a dangling foreign key and an oversized value 400", () => {
        expect(prismaErrorResponse({ code: "P2003" })?.status).toBe(400);
        expect(prismaErrorResponse({ code: "P2000" })?.status).toBe(400);
    });

    it("leaves anything it does not name alone, so a real fault stays a 500", () => {
        for (const error of [null, undefined, "P2025", new Error("boom"), { code: "P2021" }, { code: 2025 }, { code: "NOPE" }]) {
            expect(prismaErrorResponse(error)).toBeNull();
        }
    });

    it("does not need instanceof, which a dynamic import can defeat", () => {
        // A plain object with the documented shape is enough, because a module
        // handler's error crosses an import() boundary before it is caught.
        expect(prismaErrorResponse(Object.assign(new Error("x"), { code: "P2002" }))?.status).toBe(409);
    });
});

describe("prismaErrorOrThrow", () => {
    it("answers a known code", async () => {
        const response = prismaErrorOrThrow({ code: "P2025" });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Not found" });
    });

    it("rethrows anything else rather than hiding it behind a 4xx", () => {
        const boom = new Error("connection lost");
        expect(() => prismaErrorOrThrow(boom)).toThrow(boom);
    });
});

describe("the module API dispatcher", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/app/api/v1/[...path]/route.ts"), "utf8");

    it("maps a Prisma error before falling back to 500", () => {
        expect(source).toContain("prismaErrorResponse(error)");
        const mapIndex = source.indexOf("prismaErrorResponse(error)");
        const fallbackIndex = source.indexOf('{ error: "Internal Server Error" }');
        expect(mapIndex).toBeGreaterThan(-1);
        expect(mapIndex).toBeLessThan(fallbackIndex);
    });
});

describe("core routes that write by id", () => {
    it("catch, check first, or say why they need neither", () => {
        const offenders: string[] = [];
        for (const file of routeFiles(path.join(ROOT, "src/app/api"))) {
            const rel = relativePath(ROOT, file);
            if (GUARDED_ELSEWHERE[rel]) continue;
            const writes = unguardedWrites(fs.readFileSync(file, "utf8"));
            if (writes.length > 0) offenders.push(`${rel}: ${writes.join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });

    it("reads a route the way the scanner claims", () => {
        const sample = `
export async function GET() { await prisma.thing.delete({ where: { id } }); }
export async function DELETE() { await prisma.thing.delete({ where: { id } }); }
export async function PATCH() { try { await prisma.other.update({}); } catch {} }
export async function PUT() { await prisma.third.findUnique({}); await prisma.third.update({}); }
`;
        // GET is not a mutation, the try and the lookup both count as guards.
        expect(unguardedWrites(sample)).toEqual(["DELETE thing.delete"]);
    });
});
