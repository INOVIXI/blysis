// @vitest-environment node
/**
 * A role that holds one panel permission opens one part of the panel.
 *
 * `scripts/generate-registry.ts` writes a table of which permission opens
 * which panel path, and `permission-map.ts` says in so many words that the
 * enforcement reads `undeclared` as no. Measured on 2026-09-20: nothing read
 * either. `adminPageRequirement` had no caller outside its own test, the
 * proxy did not consult it, the admin shell asked `isAdmin` and nothing else,
 * and the sidebar drew whatever a manifest listed.
 *
 * So the whole of `admin.*` was decorative. An operator could grant
 * `admin.moderation` to a moderator role and that moderator was still sent to
 * the home page by the shell, because the shell only knows one question. The
 * roles screen offered twenty-odd names that changed nothing a person could
 * see.
 *
 * Three rules, and the third is what keeps this safe to ship:
 *
 * - somebody holding a panel permission may open the screens it names,
 * - and no others, including a panel path nobody declared,
 * - and an administrator opens everything, exactly as before. Nobody who
 *   could reach the panel yesterday loses anything.
 */
import { describe, it, expect } from "vitest";
import { mayEnterPanel, mayOpenAdminPath, type PanelReader } from "@/core/lib/admin-access";
import { buildNavGroups } from "@/core/lib/admin-nav-groups";

const administrator: PanelReader = { isAdmin: true, permissions: new Set() };
const moderator: PanelReader = {
    isAdmin: false,
    permissions: new Set(["admin.access", "admin.moderation"]),
};
const member: PanelReader = { isAdmin: false, permissions: new Set() };

describe("getting into the panel at all", () => {
    it("is open to an administrator", () => {
        expect(mayEnterPanel(administrator)).toBe(true);
    });

    it("is open to a role that was granted the panel", () => {
        expect(mayEnterPanel(moderator)).toBe(true);
    });

    it("is shut to a member who holds nothing", () => {
        expect(mayEnterPanel(member)).toBe(false);
    });
});

describe("a moderator inside the panel", () => {
    it("opens the screens their permission names", () => {
        expect(mayOpenAdminPath(moderator, "/tr/admin/warnings")).toBe(true);
        expect(mayOpenAdminPath(moderator, "/en/admin/ip-blocks")).toBe(true);
    });

    it("does not open one it does not", () => {
        expect(mayOpenAdminPath(moderator, "/tr/admin/settings/general")).toBe(false);
        expect(mayOpenAdminPath(moderator, "/en/admin/users")).toBe(false);
    });

    it("reaches the panel's own front door, which is what they were granted", () => {
        expect(mayOpenAdminPath(moderator, "/tr/admin")).toBe(true);
    });

    it("does not open a panel path nobody declared", () => {
        // The safe direction, and the one `permission-map.ts` already
        // describes: a screen that forgot to declare itself is an
        // administrator's until somebody says otherwise.
        expect(mayOpenAdminPath(moderator, "/tr/admin/a-screen-nobody-declared")).toBe(false);
    });
});

describe("an administrator", () => {
    it("opens every screen, declared or not", () => {
        expect(mayOpenAdminPath(administrator, "/tr/admin/settings/general")).toBe(true);
        expect(mayOpenAdminPath(administrator, "/tr/admin/a-screen-nobody-declared")).toBe(true);
    });
});

describe("somebody with no business in the panel", () => {
    it("opens nothing, whatever the path says", () => {
        expect(mayOpenAdminPath(member, "/tr/admin")).toBe(false);
        expect(mayOpenAdminPath(member, "/tr/admin/warnings")).toBe(false);
    });
});

describe("a query string or a trailing slash", () => {
    it("does not change the answer", () => {
        expect(mayOpenAdminPath(moderator, "/tr/admin/warnings/")).toBe(true);
        expect(mayOpenAdminPath(moderator, "/tr/admin/warnings?page=2")).toBe(true);
    });
});

describe("the sidebar a moderator is shown", () => {
    /** Every link in a built set of groups, flattened. */
    function links(reader: PanelReader): string[] {
        return buildNavGroups({
            mayOpen: (href) => mayOpenAdminPath(reader, `/tr${href}`),
        }).flatMap((group) => group.sections.flatMap((section) => section.items.map((item) => item.href)));
    }

    it("holds the screens they can open", () => {
        expect(links(moderator)).toContain("/admin/warnings");
    });

    it("holds none they cannot, so no link in the panel is a refusal", () => {
        const drawn = links(moderator);
        expect(drawn).not.toContain("/admin/settings/general");
        expect(drawn).not.toContain("/admin/users");
    });

    it("is the whole panel for an administrator", () => {
        const all = links(administrator);
        expect(all).toContain("/admin/settings/general");
        expect(all).toContain("/admin/users");
        expect(all.length).toBeGreaterThan(20);
    });

    it("is the whole panel when nobody asks the question", () => {
        // No predicate is the answer core gives every other caller of this
        // builder - the breadcrumb, the palette - and they are not drawing a
        // menu for a person.
        expect(buildNavGroups().length).toBeGreaterThan(0);
    });
});
