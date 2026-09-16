// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Core's own environment file knows no module.
 *
 * `.env.example` is core documentation - it ships with an installation that
 * has nothing installed - and it had drifted into naming three modules: a
 * storage provider as the example value of `STORAGE_PROVIDER`, an OAuth module
 * and its Steam API key in the prose above it, and a mail provider's
 * `RESEND_API_KEY` under a heading that called it "the current email
 * provider". The file's own header says a module's variables are not here,
 * which is how far apart the two had got.
 *
 * It matters beyond tidiness. An operator reading this file learns that the
 * platform has an email provider called Resend and a storage provider called
 * R2, neither of which is installed; a fork that ships different modules hands
 * its operators a file describing somebody else's. The same rule that keeps
 * `src/core` from naming a module applies to the file core ships beside it.
 *
 * Two questions, because a module id can be an ordinary word. A compound id
 * never is, and a variable that only a manifest declares is a module's by
 * construction - core reads it through the declaration, never by name.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXAMPLE = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");

function manifests(): Record<string, unknown>[] {
    const dir = path.join(ROOT, "module-sources");
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name, "module.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>);
}

/** Every string in a manifest that is shaped like an environment variable. */
function declaredEnvNames(node: unknown, out = new Set<string>()): Set<string> {
    if (typeof node === "string") {
        // An underscore, so an HTTP method or a status word is not mistaken
        // for a variable name.
        if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(node)) out.add(node);
    } else if (Array.isArray(node)) {
        for (const item of node) declaredEnvNames(item, out);
    } else if (node && typeof node === "object") {
        for (const value of Object.values(node)) declaredEnvNames(value, out);
    }
    return out;
}

function coreSources(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) coreSources(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const CORE_READS = new Set<string>();
for (const file of [
    ...coreSources(path.join(ROOT, "src/core")),
    ...coreSources(path.join(ROOT, "src/app")),
    ...coreSources(path.join(ROOT, "scripts")),
    ...coreSources(path.join(ROOT, "prisma")),
]) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
        CORE_READS.add(match[1]);
    }
}

const MODULE_IDS = fs
    .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

const THEME_IDS = fs
    .readdirSync(path.join(ROOT, "src/themes"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

describe(".env.example", () => {
    it("finds something to compare, so a broken scan cannot pass quietly", () => {
        expect(MODULE_IDS.length).toBeGreaterThan(50);
        expect(CORE_READS.size).toBeGreaterThan(30);
        expect(EXAMPLE.length).toBeGreaterThan(2000);
    });

    it("names no module and no theme", () => {
        const named = [...MODULE_IDS, ...THEME_IDS]
            .filter((id) => id.includes("-"))
            .filter((id) => new RegExp(`\\b${id}\\b`).test(EXAMPLE))
            .sort();
        expect(named, "core ships this file with nothing installed").toEqual([]);
    });

    it("documents no variable that only a module declares", () => {
        const declared = new Set<string>();
        for (const manifest of manifests()) declaredEnvNames(manifest, declared);

        const theirs = [...declared]
            .filter((name) => !CORE_READS.has(name))
            .filter((name) => new RegExp(`\\b${name}\\b`).test(EXAMPLE))
            .sort();
        expect(theirs, "a module's variable belongs to the module that reads it").toEqual([]);
    });
});
