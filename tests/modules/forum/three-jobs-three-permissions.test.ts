// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../../unit/source-text";

/**
 * Pinning a topic, editing somebody else's, and deleting it are three jobs.
 *
 * They were one: `isAdmin`. So a site that wanted a moderator who could lock a
 * thread had to make that person an administrator, which also handed them the
 * payment settings and the database. And the permission the forum already
 * declared for exactly this - `forum.moderate` - gated nothing, because no
 * handler asked for it.
 *
 * Editing and deleting a post of your own are not on this list. They are not
 * permissions: the author is the author, and a rule that let somebody edit
 * their own writing only while holding a grant would be a worse forum.
 */

const ROOT = process.cwd();

function handler(file: string): string {
    return stripComments(fs.readFileSync(path.join(ROOT, "module-sources/forum", file), "utf8"));
}

describe("a topic", () => {
    const topic = handler("api/topics/[id]/route.ts");

    it("is pinned and locked by whoever may moderate", () => {
        expect(topic).toContain('"forum.moderate"');
    });

    it("is edited by its author, or by whoever may edit anybody's", () => {
        expect(topic).toContain('"forum.edit-any"');
    });

    it("is deleted by its author, or by whoever may delete anybody's", () => {
        expect(topic).toContain('"forum.delete-any"');
    });

    it("asks for a permission rather than for the admin role", () => {
        // `isAdmin` in here is the shape this replaces: one answer for three
        // questions, and the only way to say yes to any of them was to say yes
        // to the whole site.
        expect(topic).not.toMatch(/\bisAdmin\s*\(/);
    });
});

describe("a post", () => {
    const post = handler("api/posts/[id]/route.ts");

    it("is edited or removed by its author, or by whoever may act on anybody's", () => {
        expect(post).toMatch(/"forum\.(edit-any|delete-any)"/);
        expect(post).not.toMatch(/\bisAdmin\s*\(/);
    });
});
