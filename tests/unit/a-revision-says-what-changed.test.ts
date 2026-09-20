// @vitest-environment node
/**
 * The audit trail names the thing that changed.
 *
 * `/admin/revisions` is a real screen with a real answer - every content
 * update and delete across the platform, who made it and when - and it
 * printed the kind in monospace as `forum.post`. That is how the code refers
 * to a forum post; it is not what a forum post is called, and the panel has
 * a rule about which of the two a reader is shown.
 *
 * A module that records a revision names the kind it records, under the key
 * core derives from the resource string, in both locales. Nothing else has to
 * agree on anything: the resource is the module's own word and stays opaque.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");

/** The key core looks a resource up under: `blog.article` -> `revision_blog_article`. */
function revisionNameKey(resource: string): string {
    return `revision_${resource.replace(/\./g, "_")}`;
}

/** Every `recordRevision("<resource>"` in a module, with the module it is in. */
function recorded(): { module: string; resource: string }[] {
    const found: { module: string; resource: string }[] = [];
    const walk = (dir: string, module: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full, module);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            for (const match of source.matchAll(/recordRevision\(\s*["']([a-z0-9.-]+)["']/g)) {
                found.push({ module, resource: match[1] });
            }
        }
    };
    for (const id of fs.readdirSync(SOURCES)) {
        const dir = path.join(SOURCES, id);
        if (!fs.existsSync(path.join(dir, "module.json"))) continue;
        walk(dir, id);
    }
    return found;
}

interface Manifest {
    translations?: Record<string, Record<string, Record<string, string>>>;
}

describe("a kind of thing the audit trail records", () => {
    const all = recorded();

    it("finds the modules that record one", () => {
        expect(all.length).toBeGreaterThan(3);
    });

    it("is named in every locale core ships", () => {
        const missing: string[] = [];
        for (const { module, resource } of all) {
            const manifest = JSON.parse(
                fs.readFileSync(path.join(SOURCES, module, "module.json"), "utf8"),
            ) as Manifest;
            for (const locale of ["en", "tr"]) {
                const words = manifest.translations?.[locale]?.admin ?? {};
                if (!words[revisionNameKey(resource)]) {
                    missing.push(`${module}/${locale}: admin.${revisionNameKey(resource)} (${resource})`);
                }
            }
        }
        expect([...new Set(missing)]).toEqual([]);
    });

    it("has its action written in words too", () => {
        const words = JSON.parse(
            fs.readFileSync(path.join(ROOT, "messages-core/en.json"), "utf8"),
        ) as { admin: Record<string, string> };
        const tr = JSON.parse(
            fs.readFileSync(path.join(ROOT, "messages-core/tr.json"), "utf8"),
        ) as { admin: Record<string, string> };
        for (const action of ["update", "delete"]) {
            expect(words.admin[`revisions_action_${action}`]).toBeTruthy();
            expect(tr.admin[`revisions_action_${action}`]).toBeTruthy();
        }
    });

    it("is looked up by the screen rather than printed raw", () => {
        const screen = fs.readFileSync(
            path.join(ROOT, "src/app/[locale]/(admin)/admin/revisions/page.tsx"),
            "utf8",
        );
        expect(screen).toContain("revisionName");
        // The monospace line that printed the machine name is what this
        // replaced; a reader should not be able to tell the two apart by
        // looking, because they should not see the machine one.
        expect(screen).not.toMatch(/title=\{rev\.resource\}/);
    });
});
