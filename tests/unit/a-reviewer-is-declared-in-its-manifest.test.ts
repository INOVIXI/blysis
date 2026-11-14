// @vitest-environment node
/**
 * A module that reviews the moderation queue says so in its manifest.
 *
 * `moderationReviewer` names a handler, the registry generator collects it
 * into `src/core/generated/module-moderation.ts`, and core's review round
 * hands it what is waiting. Core never names the module, and the module never
 * names a kind of post: both meet in the registry.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** A real, valid manifest to change one key of. */
function base(): Record<string, unknown> {
    return JSON.parse(read("module-sources/resend-provider/module.json"));
}

describe("the moderationReviewer manifest key", () => {
    it("takes a name and a handler inside the module", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), moderationReviewer: { name: "Example reviewer", handler: "reviewer/index.ts" } });
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("refuses a key it does not know", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), moderationReviewer: { name: "Example reviewer", handler: "reviewer/index.ts", kinds: ["forum-post"] } });
        expect(parsed.success).toBe(false);
    });

    it("refuses a handler outside the module", () => {
        const parsed = moduleManifestSchema.safeParse({ ...base(), moderationReviewer: { name: "Example reviewer", handler: "../other/reviewer.ts" } });
        expect(parsed.success).toBe(false);
    });

    it("refuses a reviewer with no handler", () => {
        expect(moduleManifestSchema.safeParse({ ...base(), moderationReviewer: { name: "Example reviewer" } }).success).toBe(false);
    });
});

describe("the registry", () => {
    it("lists every declared reviewer beside the moderation providers", () => {
        const generated = read("src/core/generated/module-moderation.ts");
        expect(generated).toMatch(/export interface ModerationReviewer \{/);
        expect(generated).toMatch(/export const ModuleModerationReviewers:/);
    });
});
