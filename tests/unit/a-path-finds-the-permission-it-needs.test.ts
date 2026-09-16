// @vitest-environment node
import { describe, it, expect } from "vitest";
import { adminPageRequirement, apiWriteRequirement } from "@/core/lib/permission-map";
import { ADMIN_PAGE_RULES, API_WRITE_RULES } from "@/core/generated/permission-map";

/**
 * A path answers with the permission that opens it.
 *
 * This is the lookup the panel's door will make, so it is written before the
 * door is moved. Two properties matter more than the individual answers.
 *
 * A rule is anchored at the end of the path. A prefix rule for
 * `/api/v1/users` also matches `/api/v1/users/me`, which is a member editing
 * their own account: the looser rule would have demanded an operator's
 * permission for it, and a member would have been refused their own profile.
 *
 * And an unknown path answers `undeclared`, which the enforcement reads as no.
 * A panel path nobody declared is reachable by an administrator and by nobody
 * else.
 */

describe("a panel path", () => {
    it("has rules to answer from", () => {
        expect(ADMIN_PAGE_RULES.length).toBeGreaterThan(100);
        expect(API_WRITE_RULES.length).toBeGreaterThan(200);
    });

    it("names the permission core declared for its own screens", () => {
        expect(adminPageRequirement("/tr/admin/users")).toEqual({ kind: "permission", name: "admin.users" });
        expect(adminPageRequirement("/en/admin/backup")).toEqual({ kind: "permission", name: "admin.backups" });
        expect(adminPageRequirement("/tr/admin")).toEqual({ kind: "permission", name: "admin.access" });
    });

    it("answers a deeper screen with its own row, not its parent's", () => {
        expect(adminPageRequirement("/en/admin/modules/updates")).toEqual({
            kind: "permission",
            name: "admin.modules",
        });
        expect(adminPageRequirement("/en/admin/settings/theme")).toEqual({
            kind: "permission",
            name: "admin.themes",
        });
        expect(adminPageRequirement("/en/admin/settings/general")).toEqual({
            kind: "permission",
            name: "admin.settings",
        });
    });

    it("names the permission a module declared for a screen of its own", () => {
        expect(adminPageRequirement("/tr/admin/blog/articles/new")).toEqual({
            kind: "permission",
            name: "blog.manage",
        });
    });

    it("reads a dynamic segment as one segment", () => {
        expect(adminPageRequirement("/en/admin/users/clx123")).toEqual({ kind: "permission", name: "admin.users" });
        expect(adminPageRequirement("/en/admin/users/clx123/anything-else")).toEqual({ kind: "undeclared" });
    });

    it("says undeclared for a path nobody claimed", () => {
        expect(adminPageRequirement("/en/admin/there-is-no-such-screen")).toEqual({ kind: "undeclared" });
    });

    it("does not answer for a page outside the panel", () => {
        expect(adminPageRequirement("/en/store")).toEqual({ kind: "undeclared" });
    });
});

describe("a write", () => {
    it("names the permission core declared for it", () => {
        expect(apiWriteRequirement("/api/v1/users")).toEqual({ kind: "permission", name: "admin.users" });
        expect(apiWriteRequirement("/api/v1/roles/clx1")).toEqual({ kind: "permission", name: "admin.roles" });
    });

    it("keeps a member's own account out of the operator's permission", () => {
        expect(apiWriteRequirement("/api/v1/users/me")).toEqual({ kind: "open", openTo: "member" });
        expect(apiWriteRequirement("/api/v1/me/avatar")).toEqual({ kind: "open", openTo: "member" });
        expect(apiWriteRequirement("/api/v1/sessions/abc")).toEqual({ kind: "open", openTo: "member" });
    });

    it("lets a provider callback through, because it authenticates itself", () => {
        expect(apiWriteRequirement("/api/v1/coinbase-commerce/webhook")).toEqual({
            kind: "open",
            openTo: "public",
        });
    });

    it("says undeclared for an endpoint nobody claimed", () => {
        expect(apiWriteRequirement("/api/v1/there-is-no-such-endpoint")).toEqual({ kind: "undeclared" });
    });
});
