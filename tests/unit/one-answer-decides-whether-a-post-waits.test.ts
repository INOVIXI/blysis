import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { grepTree } from "./source-text";

/**
 * Whether a person's post is published or queued is decided in one place.
 *
 * Four modules used to carry their own copy of `getModerationMode`, kept byte
 * for byte the same by this file because a drift would decide whether
 * something a stranger wrote appears on the site immediately. The decision
 * moved into `@/core/sdk/server` as `moderationStateFor` on 2026-11-13, when a
 * third mode (a reviewing module) was about to be added: four copies would
 * each have needed it, and the one that missed it would publish what the
 * others hold.
 *
 * So the rule now is that no module decides for itself.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

const CALLERS = [
    "module-sources/forum/api/topics/route.ts",
    "module-sources/forum/api/topics/[id]/route.ts",
    "module-sources/blog/api/comments/route.ts",
    "module-sources/suggestions/api/route.ts",
];

describe("whether a post waits for a moderator", () => {
    it("is never decided by a module's own copy of the rule", () => {
        // The same walk finds the callers, so a scan that read nothing fails here.
        const asking = grepTree(ROOT, "moderationStateFor\\(", ["module-sources"], [".ts", ".tsx"]);
        expect(asking.length, "the scan found none of the modules that ask core").toBeGreaterThanOrEqual(CALLERS.length);

        const deciding = grepTree(ROOT, "function\\s+getModerationMode\\b", ["module-sources"], [".ts", ".tsx"]);
        expect(deciding).toEqual([]);
    });

    it("is asked of core by every module that publishes what a stranger wrote", () => {
        for (const file of CALLERS) {
            const source = fs.readFileSync(path.join(ROOT, file), "utf8");
            expect(source, `${file} no longer asks core`).toMatch(/moderationStateFor\(/);
        }
    });

    it("reads the setting the moderation screen writes", () => {
        const screen = fs.readFileSync(
            path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/moderation/page.tsx"),
            "utf8",
        );
        // The screen sends { moderation: { <settingKey>: "auto" | "manual" } }.
        expect(screen).toMatch(/moderation:\s*config/);
        const rule = fs.readFileSync(path.join(ROOT, "src/core/lib/moderation-mode.ts"), "utf8");
        expect(rule).toContain('key: "moderation"');
    });
});
