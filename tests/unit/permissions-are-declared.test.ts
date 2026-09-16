import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_PERMISSIONS, permissionModule } from "@/core/lib/permission-names";
import { CORE_ADMIN_SCREENS } from "@/core/lib/admin-screens";
import { stripComments } from "./source-text";

/**
 * The roles screen is an authorization surface, and an authorization surface
 * that reports success without acting is worse than none: an operator builds a
 * "moderator" role, ticks the boxes, assigns it, and believes the user is now
 * restricted to those things.
 *
 * Two halves have to line up for one permission name to mean anything:
 *
 *   1. a module DECLARES the name in its manifest, which is the only way the
 *      name reaches the roles screen as a checkbox and the only way a
 *      `Permission` row for it is ever created;
 *   2. some code CHECKS the name, via one of the helpers in
 *      `@/core/lib/permissions`.
 *
 * A name with only half of that is a bug in one of two directions. Checked but
 * not declared is the worse one - the check can never pass for a non-admin,
 * because no operator can grant a permission the UI does not offer. That was
 * live in `custom-forms`, which declared `forms.manage` and checked
 * `custom-forms.manage`.
 *
 * Declared but not checked is the milder one, and it is currently the norm
 * rather than the exception: most module permissions gate nothing, because
 * every admin route gates on `isAdmin` instead. That is a product decision to
 * make deliberately, not a thing to fix silently, so this file pins the exact
 * inventory rather than failing on it. The list may shrink freely. It may not
 * grow: a new declaration has to arrive with the check that gives it meaning.
 */

const ROOT = path.resolve(__dirname, "../..");
const MODULE_SOURCES = path.join(ROOT, "module-sources");

/** The permission helpers. A name reaching any of them counts as enforced. */
const HELPERS = ["hasPermission", "hasAnyPermission", "hasAllPermissions", "requirePermission"];

/**
 * Namespaces a module may declare into besides its own id. `admin` is core's,
 * and a module that extends the admin panel itself declares into it rather
 * than inventing a parallel name for the same screen.
 */
const SHARED_NAMESPACES = new Set(["admin"]);

/**
 * Declared, offered on the roles screen, and enforced by nothing. Every entry
 * here is a checkbox an operator can tick that changes no behaviour.
 *
 * Delete an entry when you wire its permission into the routes it should
 * govern. Do not add one.
 */
const DECLARED_BUT_UNENFORCED = [
    "admin.export",
    "admin.webhooks",
    "announcements.manage",
    "changelog.manage",
    "cloudflare-r2.manage",
    "credits.manage",
    "credits.view",
    "forum.manage",
    "forum.moderate",
    "forum.view",
    "help-center.manage",
    "help-center.view",
    "popups.manage",
    "punishments.manage",
    "referral.manage",
    "seo.manage",
    "servers.manage",
    "slider.manage",
    "staff.manage",
    "store.manage",
    "store.view",
    "suggestions.manage",
    "tickets.create",
    "tickets.reply",
    "tickets.view",
    "trophies.manage",
    "vote.manage",
    "wheel.manage",
];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * Comments are stripped first. `permissions.ts` documents its own API with a
 * `hasPermission(userId, "blog.manage")` example, and an example is not an
 * enforcement site.
 */

/** Every permission name passed to a helper as a plain string literal. */
function checkedNames(files: string[]): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const pattern = new RegExp(`\\b(?:${HELPERS.join("|")})\\s*\\(([^)]*)\\)`, "g");
    for (const file of files) {
        const body = stripComments(fs.readFileSync(file, "utf8"));
        for (const match of body.matchAll(pattern)) {
            for (const literal of match[1].matchAll(/["']([a-z0-9-]+\.[a-z0-9-]+)["']/g)) {
                const name = literal[1];
                found.set(name, [...(found.get(name) ?? []), path.relative(ROOT, file)]);
            }
        }
    }
    return found;
}

const moduleIds = fs
    .readdirSync(MODULE_SOURCES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(MODULE_SOURCES, e.name, "module.json")))
    .map((e) => e.name);

/** moduleId -> declared permission names. */
const declaredByModule = new Map<string, string[]>(
    moduleIds.map((id) => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(MODULE_SOURCES, id, "module.json"), "utf8")
        ) as { permissions?: string[] };
        return [id, manifest.permissions ?? []];
    })
);

const allDeclared = new Set<string>([
    ...CORE_PERMISSIONS,
    ...[...declaredByModule.values()].flat(),
]);

const coreChecks = checkedNames(walk(path.join(ROOT, "src")));
const moduleChecks = new Map<string, Map<string, string[]>>(
    moduleIds.map((id) => [id, checkedNames(walk(path.join(MODULE_SOURCES, id)))])
);

describe("permission declarations", () => {
    it("finds the modules and their declarations", () => {
        expect(moduleIds.length).toBeGreaterThan(20);
        expect(allDeclared.size).toBeGreaterThan(25);
    });

    it("declares every permission name a module's own code checks", () => {
        const undeclared: string[] = [];
        for (const [id, checks] of moduleChecks) {
            const declared = new Set(declaredByModule.get(id) ?? []);
            for (const [name, files] of checks) {
                if (!declared.has(name)) undeclared.push(`${name} checked in ${files.join(", ")}`);
            }
        }
        expect(undeclared).toEqual([]);
    });

    it("declares every permission name core checks", () => {
        const undeclared = [...coreChecks.keys()].filter((name) => !allDeclared.has(name));
        expect(undeclared).toEqual([]);
    });

    it("namespaces every declared permission under its own module id", () => {
        const misnamed: string[] = [];
        for (const [id, names] of declaredByModule) {
            for (const name of names) {
                const ns = permissionModule(name);
                if (ns !== id && !SHARED_NAMESPACES.has(ns)) misnamed.push(`${id} declares ${name}`);
            }
        }
        expect(misnamed).toEqual([]);
    });

    it("shapes every declared permission as <namespace>.<action>", () => {
        const malformed = [...allDeclared].filter((name) => !/^[a-z0-9-]+\.[a-z0-9-]+$/.test(name));
        expect(malformed).toEqual([]);
    });
});

describe("permission enforcement", () => {
    /**
     * A name means something in one of two ways.
     *
     * It is passed to a helper somewhere, which is how the three enforced
     * names have always worked. Or a screen declares that it is what opens it,
     * which is the newer half: the panel reads the same declaration the
     * sidebar draws from, so the name decides who gets in without any handler
     * naming it. A name with neither is a checkbox that does nothing.
     */
    const enforced = new Set<string>([
        ...coreChecks.keys(),
        ...[...moduleChecks.values()].flatMap((m) => [...m.keys()]),
        ...CORE_ADMIN_SCREENS.map((screen) => screen.permission),
    ]);

    it("enforces at least the permissions the pinned inventory leaves out", () => {
        const actuallyEnforced = [...allDeclared].filter((name) => enforced.has(name)).sort();
        expect(actuallyEnforced).toEqual([
            "admin.access",
            "admin.backups",
            "admin.content",
            "admin.messaging",
            "admin.moderation",
            "admin.modules",
            "admin.observability",
            "admin.roles",
            "admin.security",
            "admin.settings",
            "admin.themes",
            "admin.users",
            "custom-forms.manage",
            "downloads.manage",
            "tickets.manage",
        ]);
    });

    it("has not grown the set of permissions that gate nothing", () => {
        const unenforced = [...allDeclared].filter((name) => !enforced.has(name)).sort();
        const pinned = new Set(DECLARED_BUT_UNENFORCED);
        expect(unenforced.filter((name) => !pinned.has(name))).toEqual([]);
    });

    it("keeps the pinned inventory free of names that are now enforced or gone", () => {
        const stale = DECLARED_BUT_UNENFORCED.filter(
            (name) => !allDeclared.has(name) || enforced.has(name)
        );
        expect(stale).toEqual([]);
    });
});
