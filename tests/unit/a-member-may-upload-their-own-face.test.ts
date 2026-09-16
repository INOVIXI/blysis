/**
 * A member can put a picture on their own profile, and an operator can stop
 * them.
 *
 * `/api/v1/upload` is admin only, and rightly so: it takes 50 MB of anything
 * on the allowlist - PDFs, ZIPs, JSON - into the site's media library, which
 * is an operator's tool. So the avatar field on a member's own account was a
 * bare URL box: the one image on the site that belongs to the person looking
 * at it was the one image they could not upload.
 *
 * Widening the admin endpoint would have been the wrong answer. What a member
 * may store is a different question from what an operator may store, and it
 * needs its own answer:
 *
 *   - one picture, of a kind a browser draws. No SVG: it is a document that
 *     can carry script, and an avatar is shown beside a member's name on
 *     every page they have ever posted on.
 *   - small, because an avatar is displayed at 80 pixels.
 *   - its own rate limit, per member, because the cost of this endpoint is
 *     disk that nobody reviews.
 *   - off if the operator says so. A site that does not want member-supplied
 *     pictures at all should not have to police them.
 *
 * Storage stays whatever the site has installed. The route calls
 * `uploadFile`, which asks the active provider - the filesystem when no
 * provider module is installed, whatever is installed when one is. Nothing
 * here names a provider.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, "src/app/api/v1/me/avatar/route.ts");

describe("the endpoint a member's avatar comes from", () => {
    it("exists", () => {
        expect(fs.existsSync(ROUTE), "src/app/api/v1/me/avatar/route.ts").toBe(true);
    });

    const source = () => fs.readFileSync(ROUTE, "utf8");

    it("asks who is calling, and does not ask them to be an admin", () => {
        expect(source()).toContain("await auth()");
        expect(source(), "an avatar is not an admin tool").not.toContain("isAdmin");
    });

    it("takes only pictures a browser draws", () => {
        const code = source();
        for (const kind of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
            expect(code, kind).toContain(kind);
        }
        expect(code, "an SVG is a document that can carry script").not.toContain("image/svg");
        for (const kind of ["application/pdf", "application/zip", "application/json"]) {
            expect(code, kind).not.toContain(kind);
        }
    });

    it("is small, because an avatar is drawn at eighty pixels", () => {
        const size = /AVATAR_MAX_SIZE\s*=\s*([\d_ *]+)/.exec(source())?.[1] ?? "";
        expect(size, "a size should be stated").not.toBe("");
        // eslint-disable-next-line no-eval
        expect(eval(size)).toBeLessThanOrEqual(4 * 1024 * 1024);
    });

    it("counts what one member may do, not what one address may", () => {
        const code = source();
        expect(code).toContain("rateLimit");
        expect(code).toMatch(/avatar:\$\{session\.user\.id\}|`avatar:/);
    });

    it("can be switched off by the operator", () => {
        expect(source()).toContain("memberAvatarUploads");
        const setting = fs.readFileSync(path.join(ROOT, "src/core/lib/member-uploads.ts"), "utf8");
        expect(setting).toContain("member_avatar_uploads");
        // On unless somebody turns it off: a member with no picture is the
        // state this exists to fix.
        expect(setting).toMatch(/=== "false"|!== "false"/);
    });

    it("stores through the provider the site has, naming none of them", () => {
        const code = source();
        expect(code).toContain("uploadFile");
        for (const provider of ["r2", "R2", "s3", "S3", "cloudflare", "amazon"]) {
            expect(code, `core must not name ${provider}`).not.toContain(provider);
        }
    });

    it("writes down what it stored, so an account deletion can take it back", () => {
        expect(source()).toContain("mediaItem.create");
        expect(source()).toContain("uploadedById");
    });
});
