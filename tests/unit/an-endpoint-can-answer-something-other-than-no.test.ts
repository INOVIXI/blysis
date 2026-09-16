import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * An endpoint that only ever says no is a control that only ever fails.
 *
 * `csv-import-export` offers "Import Products (CSV)" in the admin screen. The
 * button posts to `/api/v1/admin/import?type=products`, and that route's
 * switch has one branch: `default`, answering 400 "No import types available.
 * Module-specific imports should use module APIs." The message is right, and
 * that is the point. Imports moved to the modules that own the data and this
 * generic endpoint stayed behind, with a file picker still pointed at it. An
 * operator picks a CSV and is told the import did not finish, every time,
 * with no import having started.
 *
 * Measured across 241 route files, it is the only one whose every answer is
 * an error status.
 *
 * The rule holds for handlers, not for guards: a route may answer 401, 403 or
 * 400 on most paths, as long as one path leads somewhere.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function routeFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

function withoutComments(source: string): string {
    return stripComments(source);
}

/** The argument list of every `NextResponse.json(...)` call, paren matched. */
function jsonAnswers(source: string): string[] {
    const calls: string[] = [];
    const opener = /NextResponse\.json\(/g;
    for (let m = opener.exec(source); m; m = opener.exec(source)) {
        let depth = 0;
        let i = m.index + m[0].length - 1;
        const start = i;
        for (; i < source.length; i++) {
            const c = source[i];
            if (c === "(" || c === "{" || c === "[") depth++;
            else if (c === ")" || c === "}" || c === "]") {
                depth--;
                if (depth === 0) break;
            }
        }
        calls.push(source.slice(start, i + 1));
    }
    return calls;
}

/** Ways a route hands back something that is not a refusal. */
const SAYS_YES = /apiSuccess\(|apiPaginated\(|NextResponse\.redirect|NextResponse\.next|new NextResponse\(|new Response\(/;

describe("an endpoint", () => {
    const routes = [
        ...routeFiles(path.join(ROOT, "src/app/api")),
        ...routeFiles(path.join(ROOT, "module-sources")).filter((f) => f.includes(`${path.sep}api${path.sep}`)),
    ];

    it("finds the routes to check", () => {
        expect(routes.length).toBeGreaterThan(200);
    });

    it("can answer something other than no", () => {
        const refusalOnly = routes.filter((file) => {
            const source = withoutComments(fs.readFileSync(file, "utf8"));
            if (SAYS_YES.test(source)) return false;

            // Read each `NextResponse.json(...)` call's own arguments rather
            // than counting `status:` across the file: a route that maps
            // refusals through a lookup table has more of those words than it
            // has answers, and counting them called it a route that can only
            // fail.
            const answers = jsonAnswers(source);
            if (answers.length === 0) return false;
            return answers.every((answer) => /status:\s*[45]\d\d/.test(answer));
        }).map((file) => path.relative(ROOT, file));

        expect(
            refusalOnly,
            `Every path through these ends in an error status, so whatever calls them\n` +
            `cannot succeed. Give them a success or take them, and the control that\n` +
            `calls them, out:\n${refusalOnly.join("\n")}`,
        ).toEqual([]);
    });
});
