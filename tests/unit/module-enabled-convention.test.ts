/**
 * The module enabled flag has one meaning and one helper.
 *
 * Two rules are gated here, both learned the hard way:
 *
 * 1. Nobody hand-rolls the comparison. Nineteen call sites once wrote
 *    `states[id] === true`, which reads an absent entry as disabled, while
 *    the proxy and `isModuleEnabled` read it as enabled. They agree while
 *    every module has a `ModuleConfig` row and diverge exactly when the
 *    database is unavailable, which is when the whole site's module chrome
 *    vanished while the proxy kept serving those same routes.
 *
 * 2. Every consumer of a generated registry honours the flag, unless it is
 *    listed below with the reason it must not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { stripComments } from "./source-text";

const ROOT = join(__dirname, "../..");
const GENERATED = join(ROOT, "src/core/generated");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** Source with comments removed, so prose about a rule never satisfies it. */
function code(path: string): string {
    return stripComments(readFileSync(path, "utf8"));
}

const SRC_FILES = walk(join(ROOT, "src")).filter(
    (f) => !f.startsWith(GENERATED) && !f.includes("/src/modules/"),
);

/**
 * Consumers that read a registry without consulting the enabled flag, each
 * for a reason. Anything not on this list must gate.
 *
 * `blocks-merger.ts` used to sit here, on the grounds that one Puck config
 * serves both the editor and the public renderer so dropping a block would
 * blank a page that already used it. What it actually did was mount the block
 * anyway, against a module API the proxy answers 404 for, and render a silent
 * empty region - while still offering the block in the palette. It takes a
 * mode now: the editor keeps a disabled module's block loadable and out of
 * the palette, the renderer drops it, and the exemption is gone.
 */
const UNGATED_BY_DESIGN: Record<string, string> = {
    "src/core/lib/auth.ts":
        "Auth.js builds its provider list synchronously at module load, before a database round-trip is possible. Activation is env-gated instead, as auth-providers.ts documents.",
    "src/app/api/v1/auth-providers/status/route.ts":
        "An admin diagnostic that answers why a provider shows no button. Hiding a disabled module's provider would hide the answer.",
    "src/app/api/v1/admin/dev/route.ts":
        "Registry introspection for developers. Its whole purpose is to report what is installed, enabled or not.",
    "src/core/lib/activity-title.ts":
        "Titles rows already written to the activity log. History must keep rendering after a module is turned off, or it degrades to raw keys.",
    "src/core/lib/storage.ts":
        "The active storage provider is chosen by an explicit setting. Silently redirecting new uploads to local disk would split a site's media across two backends.",
    "src/app/[locale]/(admin)/admin/permissions/page.tsx":
        "The RBAC matrix. Grants outlive a disable, and hiding the resource would hide grants an admin still needs to edit.",
    "src/core/lib/api-matcher.ts":
        "Pure path matching. The proxy gates every module API path before a request reaches it.",
    "src/app/api/v1/[...path]/route.ts":
        "Dispatches an already-matched module API path; the proxy 404s a disabled module first.",
    "src/core/lib/route-matcher.ts":
        "Pure path matching. The proxy resolves a module id from the same route map and 404s a disabled one before this runs.",
    "src/core/lib/user-data-export.ts":
        "GDPR export. A user is owed every row the platform holds about them, and disabling a module deletes nothing - excluding its tables would silently truncate the export.",
    "src/core/lib/user-deletion.ts":
        "Right to be forgotten. Disabling a module deletes nothing, so its rows are still there and still the user's; skipping them would leave the data an erasure exists to remove.",
    "src/core/lib/module-settings.ts":
        "Reads a module's own settings declaration. It is called by that module's own code, which the proxy has already gated - and an admin editing a disabled module's settings before turning it on must still see them.",
    "src/core/lib/secret-settings.ts":
        "Which settings keys are credentials. Disabling a module deletes nothing, so its keys are still in the table - gating this would stop encrypting them on write and stop decrypting what is already there, which turns a disable into a leak and a re-enable into a gateway that cannot authenticate.",
    "src/core/lib/email-config.ts":
        "The mailer is core's, and the provider module only says which key holds its credential. Mail has to keep going out while a module is being installed, updated or turned off; a password reset that silently stops sending is the failure this would cause.",
    "src/app/[locale]/[...slug]/page.tsx": "Module page catch-all, gated by the proxy.",
    "src/app/[locale]/(admin)/admin/[...slug]/page.tsx": "Module admin catch-all, gated by the proxy.",
};

describe("module enabled flag - one helper", () => {
    it("the helper reads an absent entry as enabled", async () => {
        const { isEnabledIn } = await import("@/core/lib/module-enabled");
        expect(isEnabledIn({ blog: true }, "blog")).toBe(true);
        expect(isEnabledIn({ blog: false }, "blog")).toBe(false);
        expect(isEnabledIn({}, "blog")).toBe(true);
    });

    it("matches isModuleEnabled's documented convention", () => {
        const cache = code(join(ROOT, "src/core/lib/module-cache.ts"));
        expect(cache).toContain("states[id] ?? true");
    });

    it("no file hand-rolls the comparison", () => {
        const offenders = SRC_FILES.filter((f) => {
            if (f.endsWith("/core/lib/module-enabled.ts")) return false;
            return /\w+\[[A-Za-z_$][\w.$]*\] === true/.test(code(f));
        }).map((f) => f.slice(ROOT.length + 1));
        expect(offenders).toEqual([]);
    });

    it("the client hook goes through the helper", () => {
        const provider = code(join(ROOT, "src/core/providers/module-provider.tsx"));
        expect(provider).toContain("isEnabledIn(modules, moduleId)");
    });

    it("the root layout reads module states through the shared cache", () => {
        const layout = code(join(ROOT, "src/app/[locale]/layout.tsx"));
        expect(layout).toContain("await getModuleStates()");
        expect(layout).not.toContain("moduleConfig.findMany");
    });
});

describe("module enabled flag - every registry consumer", () => {
    const registryNames = readdirSync(GENERATED)
        .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("theme"))
        .flatMap((f) =>
            Array.from(
                readFileSync(join(GENERATED, f), "utf8").matchAll(/export const (\w+)/g),
                (m) => m[1],
            ),
        )
        .filter((n) => n.startsWith("Module") || n.endsWith("Registry"));

    it("finds the generated registries", () => {
        expect(registryNames.length).toBeGreaterThan(15);
    });

    it("gates the flag or is listed as ungated by design", () => {
        const GATE = /useAllModules|getModuleStates|isModuleEnabled|isEnabledIn|moduleStatus|moduleStates|enabled\b/;
        const offenders: string[] = [];
        for (const file of SRC_FILES) {
            const src = code(file);
            const uses = registryNames.filter((n) => new RegExp(`\\b${n}\\b`).test(src));
            if (uses.length === 0) continue;
            if (GATE.test(src)) continue;
            const rel = file.slice(ROOT.length + 1);
            if (UNGATED_BY_DESIGN[rel]) continue;
            offenders.push(`${rel} (${uses.join(", ")})`);
        }
        expect(offenders).toEqual([]);
    });

    it("every ungated-by-design entry still exists and still reads a registry", () => {
        for (const rel of Object.keys(UNGATED_BY_DESIGN)) {
            const src = code(join(ROOT, rel));
            expect(
                registryNames.some((n) => new RegExp(`\\b${n}\\b`).test(src)),
                `${rel} no longer reads a generated registry - drop its exemption`,
            ).toBe(true);
        }
    });

    it("every exemption carries a reason", () => {
        for (const [rel, why] of Object.entries(UNGATED_BY_DESIGN)) {
            expect(why.length, `${rel} needs a reason`).toBeGreaterThan(40);
        }
    });

    it("the consumers fixed this round now gate", () => {
        for (const rel of [
            "src/app/api/v1/admin/search/route.ts",
            "src/app/api/v1/notification-preferences/route.ts",
        ]) {
            expect(code(join(ROOT, rel))).toContain("isEnabledIn(");
        }
    });
});
