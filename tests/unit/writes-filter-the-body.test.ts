import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A handler that hands the request body to Prisma writes whatever the caller
 * sent. `changelog`'s PATCH did: `data: { ...body }`. Its own POST parsed the
 * same fields with a zod schema, so one half of the module bounded `version`
 * to 50 characters and required `color` to be `#rrggbb` while the other half
 * accepted anything, and both wrote the same row.
 *
 * Beyond the missing bounds it reached columns no edit should: `id`, so the
 * revision rows recorded against the old value no longer pointed at anything,
 * and `createdAt`, which is the order the public list is sorted by. A key the
 * model does not have went to Prisma too and came back 500, because an unknown
 * column is a validation error thrown rather than returned.
 *
 * It was the only one of its kind in core and 78 modules, which is what makes
 * it worth pinning rather than tolerating.
 */

const ROOT = path.resolve(__dirname, "../..");

function routeFiles(): string[] {
    const out: string[] = [];
    for (const base of ["src/app", "module-sources"]) {
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === "node_modules") continue;
                    walk(full);
                } else if (entry.name === "route.ts") out.push(full);
            }
        };
        walk(path.join(ROOT, base));
    }
    return out;
}

/** Names bound to the parsed request body, plus anything spread out of one. */
function bodyNames(source: string): Set<string> {
    const names = new Set(
        [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:readJsonBody|request\.json|req\.json)\(/g)]
            .map((m) => m[1]),
    );
    for (let pass = 0; pass < 3; pass++) {
        for (const m of source.matchAll(/(?:const|let)\s+(\w+)(?::[^=]+)?\s*=\s*\{\s*\.\.\.\s*(\w+)/g)) {
            if (names.has(m[2])) names.add(m[1]);
        }
    }
    return names;
}

function unfilteredWrites(source: string): string[] {
    const names = bodyNames(source);
    if (names.size === 0) return [];
    const out: string[] = [];
    for (const m of source.matchAll(/data:\s*(?:\{\s*\.\.\.\s*)?(\w+)\s*[,}]/g)) {
        if (names.has(m[1])) out.push(m[1]);
    }
    return out;
}

const FILES = routeFiles();

describe("write handlers", () => {
    it("finds the route files", () => {
        expect(FILES.length).toBeGreaterThan(150);
    });

    it("never hand a Prisma write the request body itself", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            for (const name of unfilteredWrites(fs.readFileSync(file, "utf8"))) {
                offenders.push(`${path.relative(ROOT, file)} (data: ${name})`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe("the check itself", () => {
    it("catches a body spread into a write", () => {
        const src = `
            const body = await readJsonBody(request);
            const patchData = { ...body };
            await prisma.thing.update({ where: { id }, data: patchData });
        `;
        expect(unfilteredWrites(src)).toEqual(["patchData"]);
    });

    it("catches the body passed directly", () => {
        const src = `
            const body = await request.json();
            await prisma.thing.create({ data: body });
        `;
        expect(unfilteredWrites(src)).toEqual(["body"]);
    });

    it("accepts a write built from parsed fields", () => {
        const src = `
            const body = await readJsonBody(request);
            const parsed = schema.safeParse(body);
            const data = { title: parsed.data.title };
            await prisma.thing.update({ where: { id }, data });
        `;
        expect(unfilteredWrites(src)).toEqual([]);
    });
});

describe("the changelog PATCH that prompted this", () => {
    const route = fs.readFileSync(
        path.join(ROOT, "module-sources/changelog/api/[id]/route.ts"),
        "utf8",
    );

    it("parses its body with a schema", () => {
        expect(route).toContain("patchSchema");
        expect(route).toContain("safeParse(body)");
        expect(route).toMatch(/status: 400/);
    });

    it("keeps the bounds its own POST enforces", () => {
        const post = fs.readFileSync(
            path.join(ROOT, "module-sources/changelog/api/route.ts"),
            "utf8",
        );
        for (const bound of ['max(50)', 'max(200)', 'max(10000)', '#[0-9a-fA-F]{6}']) {
            expect(post, `POST should bound with ${bound}`).toContain(bound);
            expect(route, `PATCH should bound with ${bound}`).toContain(bound);
        }
    });

    /**
     * It used to sanitise on the way in, and that was right while the column
     * held HTML. The column holds Markdown now: cleaning it here deleted a
     * fenced code block that documented a tag, and stored `a &lt; b` where
     * somebody had typed `a < b`. The cleaning is at the render, where the
     * parser has already decided which is which. See
     * `a-writer-gets-back-what-they-typed`.
     */
    it("stores the content as the writer typed it", () => {
        expect(route).not.toContain("sanitizeHtml");
        // Still bounded, which is the part this endpoint owes a reader.
        expect(route).toContain("max(10000)");
    });
});
