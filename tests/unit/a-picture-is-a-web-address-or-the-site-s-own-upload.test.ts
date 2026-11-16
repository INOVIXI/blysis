/**
 * What a stored picture's address may be.
 *
 * A picture uploaded to a site that keeps its files on its own disk comes
 * back as `/uploads/...`, a path on the site rather than a whole address.
 * Fields that asked zod for `.url()` refused it, so a blog cover or a
 * product picture could be linked from elsewhere but never uploaded.
 *
 * Anything a page may draw is either an http(s) address or a file under the
 * site's own `/uploads/`. A path that climbs out of it, a protocol-relative
 * address that names another host, and every other scheme are refused.
 */
import { describe, it, expect } from "vitest";
import { isPictureAddress } from "@/core/sdk";

describe("a picture's address", () => {
    it("may be the site's own upload", () => {
        expect(isPictureAddress("/uploads/2026/11/cover.png")).toBe(true);
        expect(isPictureAddress("/uploads/cover-1a2b.webp")).toBe(true);
    });

    it("may be a web address", () => {
        expect(isPictureAddress("https://cdn.example.com/a.png")).toBe(true);
        expect(isPictureAddress("http://203.0.113.7:3000/uploads/a.png")).toBe(true);
    });

    it("may not climb out of the uploads folder", () => {
        expect(isPictureAddress("/uploads/../../etc/passwd")).toBe(false);
        expect(isPictureAddress("/uploads/a/../../x.png")).toBe(false);
        expect(isPictureAddress("/uploads\\..\\x.png")).toBe(false);
        expect(isPictureAddress("/uploads/%2e%2e/x.png")).toBe(false);
    });

    it("may not be another path on the site, or a relative one", () => {
        expect(isPictureAddress("/admin")).toBe(false);
        expect(isPictureAddress("/uploads/")).toBe(false);
        expect(isPictureAddress("uploads/a.png")).toBe(false);
    });

    it("may not name another host without a scheme, or use any other scheme", () => {
        expect(isPictureAddress("//evil.example/a.png")).toBe(false);
        expect(isPictureAddress("javascript:alert(1)")).toBe(false);
        expect(isPictureAddress("data:image/png;base64,AAAA")).toBe(false);
        expect(isPictureAddress("ftp://example.com/a.png")).toBe(false);
        expect(isPictureAddress("")).toBe(false);
    });
});

describe("a member's own picture", () => {
    // `/api/v1/me/avatar` answers `/uploads/...`, and the profile's schema
    // asked for a whole URL, so a member who uploaded a picture could not
    // save it.
    it("is saved when it was uploaded to the site", async () => {
        const { updateUserSchema } = await import("@/core/lib/validations");
        expect(updateUserSchema.safeParse({ avatar: "/uploads/face.png" }).success).toBe(true);
        expect(updateUserSchema.safeParse({ avatar: null }).success).toBe(true);
        expect(updateUserSchema.safeParse({ avatar: "javascript:alert(1)" }).success).toBe(false);
    });
});
