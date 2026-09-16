import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Every handler that changes a row says who is allowed to change it.
 *
 * This is the write-side twin of the read-side gates. Those ask whether a
 * visitor may see a thing; this asks whether the caller may alter it, which is
 * the more expensive one to get wrong: a read leaks, a write is somebody
 * else's ticket edited, somebody else's article deleted.
 *
 * The check has to follow a helper to be worth anything. This codebase does
 * not write `await auth()` in a handler and compare ids by hand - it writes
 * `denyUnlessAdmin()`, `canAccessTicket(userId, id, "edit")`,
 * `denyGuestView()`. A scan that only looked inside the handler reported four
 * offenders on 2026-09-07 and every one of them was a helper it could not see
 * through. So this resolves one level: functions the file defines, and
 * functions it imports from a relative path.
 *
 * One thing is asked of each handler: that some guard runs before it writes.
 *
 * A second was written and thrown away, and the reason is worth keeping. The
 * idea was to also require that the guard *names the caller* - a route which
 * checks a session exists and then writes a row identified only by a URL
 * parameter has authenticated a stranger rather than authorised an owner. It
 * cannot be checked this way. `session.user.id` appears in these handlers for
 * reasons that are not authorisation, most often as a rate-limit key, so the
 * assertion was true of every handler whatever its guard did. Breaking a real
 * ownership check on purpose left it green.
 *
 * Both assertions were tried against a deliberately broken handler. The one
 * that survives names the file and the verb when every guard token is removed;
 * the one that did not is gone rather than left as a light that is always
 * green. Telling those apart needs to know whether the id reaches a decision
 * or a cache key, which is more than a regular expression has.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Anything that decides whether this caller may proceed. */
const GUARD = /isAdmin\(|isStaff\(|requireAdmin\(|hasPermission\(|hasResourcePermission\(|canAccess\w*\(|denyGuest\w*\(|denyUnless\w*\(|\bauth\(\)/;
/** Handlers that legitimately carry no guard, and why. */
const DELEGATES: Record<string, string> = {
    "src/app/api/v1/[...path]/route.ts":
        "the module API dispatcher: it applies the rate limit and then loads the module's own handler, which authorises for itself - its comment says so, and it cannot know what any given module's rule is",
};

const strip = (s: string) => stripComments(s);

/** The full text of every function a source defines, by name. */
function functionsIn(source: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of source.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
        const brace = source.indexOf("{", m.index);
        let depth = 0;
        for (let i = brace; i < source.length; i++) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}" && --depth === 0) {
                out.set(m[1], source.slice(m.index, i + 1));
                break;
            }
        }
    }
    return out;
}

/** A handler's own text, plus the text of every helper it calls. */
function handlerWithHelpers(file: string, source: string, verb: string): string | null {
    const start = new RegExp(`export async function ${verb}\\b`).exec(source);
    if (!start) return null;
    const after = source.slice(start.index + 10);
    const next = after.search(/export async function /);
    let body = source.slice(start.index, next === -1 ? undefined : start.index + 10 + next);

    const reachable = new Map(functionsIn(source));
    for (const im of source.matchAll(/import \{([^}]+)\} from "(\.[^"]+)"/g)) {
        const target = path.resolve(path.dirname(file), im[2]);
        for (const candidate of [`${target}.ts`, `${target}/index.ts`]) {
            if (!fs.existsSync(candidate)) continue;
            const helpers = functionsIn(strip(fs.readFileSync(candidate, "utf8")));
            for (const name of im[1].split(",").map((n) => n.trim().split(" ")[0])) {
                const fn = helpers.get(name);
                if (fn) reachable.set(name, fn);
            }
        }
    }
    for (const [name, text] of reachable) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(body)) body += "\n" + text;
    }
    return body;
}

function routeFiles(dir: string, into: string[] = []): string[] {
    if (!fs.existsSync(dir)) return into;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (["generated", "node_modules", "modules"].includes(entry.name)) continue;
            routeFiles(full, into);
        } else if (entry.name === "route.ts") into.push(full);
    }
    return into;
}

const HANDLERS = ["PUT", "PATCH", "DELETE"];

function unguarded(): string[] {
    const files = [
        ...routeFiles(path.join(ROOT, "src/app/api")),
        ...routeFiles(path.join(ROOT, "module-sources")),
    ];
    const noGuard: string[] = [];
    for (const file of files) {
        const rel = path.relative(ROOT, file);
        const source = strip(fs.readFileSync(file, "utf8"));
        for (const verb of HANDLERS) {
            const body = handlerWithHelpers(file, source, verb);
            if (body === null) continue;
            if (rel in DELEGATES) continue;
            if (!GUARD.test(body)) noGuard.push(`${rel} ${verb}`);
        }
    }
    return noGuard;
}

describe("a handler that changes a row", () => {
    const noGuard = unguarded();

    it("is one of many, so this gate has something to check", () => {
        const files = [
            ...routeFiles(path.join(ROOT, "src/app/api")),
            ...routeFiles(path.join(ROOT, "module-sources")),
        ];
        const count = files.filter((f) =>
            HANDLERS.some((v) => new RegExp(`export async function ${v}\\b`).test(fs.readFileSync(f, "utf8"))),
        ).length;
        expect(count).toBeGreaterThan(20);
    });

    it("runs a guard before it writes", () => {
        expect(
            noGuard,
            "add the check, or list the file in DELEGATES with the reason it has none",
        ).toEqual([]);
    });

    it("says why the one handler without a guard does not need one", () => {
        for (const reason of Object.values(DELEGATES)) {
            expect(reason.length).toBeGreaterThan(40);
        }
    });
});
