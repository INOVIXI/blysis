import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A module that listens to another module's hook has to build without it.
 *
 * A hook's payload type is declared by the module that emits it, and when that
 * module is not installed the declaration is absent and the payload falls back
 * to `unknown` (src/core/types/hook-payloads.d.ts). A listener typed through
 * `HookHandlerFor<"that.hook">` then reads fields off `unknown`, which is a
 * compile error - and the in-place build type-checks every installed module,
 * so one such file fails the whole site's build, not just the listener.
 *
 * `typecheck:modules` never saw it: it compiles all ninety modules together,
 * where every declaration is present. The demo did: store, forum and vote
 * without the leaderboard module, and store without csv-import-export, could
 * not be built at all.
 *
 * So a listener may lean on `HookHandlerFor` only where the declaration is
 * certain to be there: in core, in the listener's own module, or in a module
 * it depends on. Anywhere else it states the shape it reads, and
 * `typecheck:modules` holds that shape against the contract when both are
 * installed.
 */

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");

interface Manifest {
    dependencies?: string[];
    hookListeners?: { hook: string; type: string; handler: string }[];
}

const manifests = new Map<string, Manifest>();
for (const id of fs.readdirSync(SOURCES).sort()) {
    const file = path.join(SOURCES, id, "module.json");
    if (fs.existsSync(file)) manifests.set(id, JSON.parse(fs.readFileSync(file, "utf-8")));
}

function filesOf(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesOf(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

/** Every hook name a file declares a payload or context for in `declare global`. */
function declaredHooks(source: string): Set<string> {
    if (!source.includes("declare global")) return new Set();
    return new Set([...source.matchAll(/^\s*"([\w.-]+)"\s*:/gm)].map((m) => m[1]));
}

const coreDeclared = declaredHooks(fs.readFileSync(path.join(ROOT, "src/core/types/hook-payloads.d.ts"), "utf-8"));

const declaredBy = new Map<string, Set<string>>();
for (const id of manifests.keys()) {
    const hooks = new Set<string>();
    for (const file of filesOf(path.join(SOURCES, id))) {
        for (const hook of declaredHooks(fs.readFileSync(file, "utf-8"))) hooks.add(hook);
    }
    declaredBy.set(id, hooks);
}

function dependenciesOf(id: string, seen = new Set<string>()): Set<string> {
    for (const dep of manifests.get(id)?.dependencies ?? []) {
        const name = dep.split("@")[0];
        if (!seen.has(name)) {
            seen.add(name);
            dependenciesOf(name, seen);
        }
    }
    return seen;
}

describe("a hook listener typed through HookHandlerFor", () => {
    it("only names hooks whose declaration is installed whenever it is", () => {
        const fragile: string[] = [];
        for (const [id, manifest] of manifests) {
            const present = [id, ...dependenciesOf(id)];
            for (const listener of manifest.hookListeners ?? []) {
                const file = path.join(SOURCES, id, listener.handler);
                if (!fs.existsSync(file)) continue;
                // Comments out: a file that explains why it no longer uses
                // HookHandlerFor names it in the explanation.
                const source = stripComments(fs.readFileSync(file, "utf-8"));
                const named = [...source.matchAll(/HookHandlerFor<\s*"([\w.-]+)"/g)].map((m) => m[1]);
                for (const hook of named) {
                    if (coreDeclared.has(hook)) continue;
                    if (present.some((m) => declaredBy.get(m)?.has(hook))) continue;
                    fragile.push(`${id}/${listener.handler}: ${hook}`);
                }
            }
        }
        expect(fragile).toEqual([]);
    });
});
