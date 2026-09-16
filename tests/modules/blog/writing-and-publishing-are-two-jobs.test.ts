// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../../unit/source-text";

/**
 * Writing an article, publishing it, and editing somebody else's are three
 * jobs, and every editorial team in the world separates at least two of them.
 *
 * They were one answer here: `isAdmin`. So a site that wanted somebody to
 * write for the blog had to make them an administrator of the whole
 * installation, and there was no way at all to let somebody draft an article
 * that an editor would release.
 *
 * The article model already carried the distinction - `status` is DRAFT or
 * PUBLISHED - and nothing read it as a permission.
 */

const ROOT = process.cwd();

function handler(file: string): string {
    return stripComments(fs.readFileSync(path.join(ROOT, "module-sources/blog", file), "utf8"));
}

describe("an article", () => {
    const article = handler("api/articles/[id]/route.ts");

    it("is edited by its author, or by whoever may edit anybody's", () => {
        expect(article).toContain('"blog.edit-any"');
    });

    it("is published only by whoever may publish", () => {
        expect(article).toContain('"blog.publish"');
    });

    it("asks for a permission rather than for the admin role", () => {
        expect(article).not.toMatch(/\bisAdmin\s*\(/);
    });
});

describe("a comment somebody left", () => {
    it("is removed by whoever may moderate, not by whoever may write", () => {
        const comments = handler("api/comments/[id]/route.ts");
        expect(comments).toContain('"blog.moderate"');
        expect(comments).not.toMatch(/\bisAdmin\s*\(/);
    });
});
