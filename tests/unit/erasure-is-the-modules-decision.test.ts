import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Who decides whether a table survives the right to be forgotten.
 *
 * `user-deletion.ts` carried a doc comment saying "this file knows nothing
 * about any specific module" directly above a list that named
 * `linkedAccount`, `notification`, `cartItem`, `forumTopicLike`,
 * `forumPostLike` and `suggestionVote` - six tables belonging to five
 * modules. Two consequences, both invisible:
 *
 * A module core had never been edited for could not have its private data
 * erased at all. `wheel` records every spin, `vote` every vote, `trophies`
 * every award, `custom-forms` every submission, and an erasure walked past
 * all of them because core's list did not mention them. There was no way for
 * a module to say otherwise: no manifest field, no hook, nothing.
 *
 * And the six that did work only worked because somebody had edited core.
 * Uninstalling `forum` left two dead entries; installing a module that ships
 * a private table did nothing until core changed too.
 *
 * A module already declares its user tables for the data export. It now says
 * what erasure does with each of them, and core reads that. The default is
 * "retain", which is what every undeclared table did before, so a manifest
 * that says nothing keeps the behaviour it had.
 */

const ROOT = process.cwd();
const DELETION = fs.readFileSync(path.join(ROOT, "src/core/lib/user-deletion.ts"), "utf8");

interface Entry { model: string; key: string; column: string; erasure?: string }

const modules = fs
    .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => fs.existsSync(path.join(ROOT, "module-sources", id, "module.json")))
    .map((id) => ({
        id,
        entries: (JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8"))
            .userDataExport ?? []) as Entry[],
        schemaPath: path.join(ROOT, "module-sources", id, "schema.prisma"),
    }));

/** Model name to column list, keyed by the Prisma delegate name. */
function schemaModels(file: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (!fs.existsSync(file)) return out;
    const source = fs.readFileSync(file, "utf8");
    for (const model of source.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
        const name = model[1];
        const columns = [...model[2].matchAll(/^\s*(\w+)\s+\S/gm)].map((m) => m[1]);
        out.set(name[0].toLowerCase() + name.slice(1), columns);
    }
    return out;
}

/** The list core still keeps for its own tables. */
function coreTargets(): { model: string; column: string }[] {
    const block = DELETION.slice(
        DELETION.indexOf("const CORE_MODELS_TO_PURGE"),
        DELETION.indexOf("export function modulePurgeTargets"),
    );
    return [...block.matchAll(/\{\s*model:\s*"(\w+)",\s*column:\s*"(\w+)"\s*\}/g)].map((m) => ({
        model: m[1],
        column: m[2],
    }));
}

describe("core's own purge list", () => {
    const core = coreTargets();

    it("is found, and holds the core tables", () => {
        expect(core.length).toBeGreaterThan(4);
        expect(core.map((t) => t.model)).toContain("userSession");
        expect(core.find((t) => t.model === "message")!.column).toBe("authorId");
    });

    it("names nothing a module ships", () => {
        // Every one of these is a regression back to core knowing a module.
        const owned = new Map<string, string>();
        for (const { id, schemaPath } of modules) {
            for (const model of schemaModels(schemaPath).keys()) owned.set(model, id);
        }
        const trespassing = core
            .filter((t) => owned.has(t.model))
            .map((t) => `${t.model} belongs to ${owned.get(t.model)}`);
        expect(trespassing).toEqual([]);
    });

    it("names a column the core schema has", () => {
        const coreModels = schemaModels(path.join(ROOT, "prisma/schema.core.prisma"));
        const wrong: string[] = [];
        for (const target of core) {
            const columns = coreModels.get(target.model);
            if (!columns) {
                // `session` is Auth.js's own table, declared by the adapter's
                // schema rather than ours; the delete is a no-op when absent.
                if (target.model === "session") continue;
                wrong.push(`${target.model} is not a core model`);
            } else if (!columns.includes(target.column)) {
                wrong.push(`${target.model} has no column ${target.column}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it("reads the module half out of the registry", () => {
        expect(DELETION).toContain("ModuleUserDataTables");
        expect(DELETION).toContain("modulePurgeTargets()");
    });
});

describe("every module table", () => {
    it("says what erasure does with it", () => {
        // Omitting it is legal for a third-party manifest and means retain.
        // In this repository it has to be a decision somebody made.
        const silent: string[] = [];
        for (const { id, entries } of modules) {
            for (const entry of entries) {
                if (entry.erasure !== "purge" && entry.erasure !== "retain") {
                    silent.push(`${id}: ${entry.model} (${entry.erasure ?? "nothing"})`);
                }
            }
        }
        expect(silent).toEqual([]);
    });

    it("is there to check", () => {
        const declared = modules.flatMap((m) => m.entries);
        expect(declared.length).toBeGreaterThan(20);
        expect(declared.filter((e) => e.erasure === "purge").length).toBeGreaterThan(4);
        expect(declared.filter((e) => e.erasure === "retain").length).toBeGreaterThan(10);
    });

    it("purges the six tables core used to purge itself", () => {
        // The behaviour this refactor must not quietly drop.
        // `linkedAccount` was a seventh. It is not here because the table is
        // gone: nothing wrote it but a text box a member typed their own
        // in-game name into, and player-profiles asks the module that proved
        // an account instead. See that module's migration 002.
        const expected: Record<string, string> = {
            notification: "in-app-notifications",
            cartItem: "store",
            forumTopicLike: "forum",
            forumPostLike: "forum",
            suggestionVote: "suggestions",
        };
        const missing: string[] = [];
        for (const [model, owner] of Object.entries(expected)) {
            const owning = modules.find((m) => m.id === owner);
            const entry = owning?.entries.find((e) => e.model === model);
            if (entry?.erasure !== "purge") missing.push(`${owner}: ${model} is ${entry?.erasure ?? "undeclared"}`);
        }
        expect(missing).toEqual([]);
    });

    it("purges on a column its own model has", () => {
        const wrong: string[] = [];
        for (const { id, entries, schemaPath } of modules) {
            const own = schemaModels(schemaPath);
            for (const entry of entries) {
                if (entry.erasure !== "purge") continue;
                const columns = own.get(entry.model);
                if (!columns) wrong.push(`${id}: ${entry.model} is not in its own schema`);
                else if (!columns.includes(entry.column)) wrong.push(`${id}: ${entry.model}.${entry.column}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it("keeps the public record, which is the whole reason for a soft delete", () => {
        // Purging any of these would take out other people's threads and the
        // evidence behind a ban.
        const mustSurvive = ["forumTopic", "forumPost", "blogArticle", "order", "ticket", "suggestion"];
        const purged = modules
            .flatMap((m) => m.entries.filter((e) => e.erasure === "purge").map((e) => e.model))
            .filter((model) => mustSurvive.includes(model));
        expect(purged).toEqual([]);
    });
});

describe("the manifest schema", () => {
    it("takes only the two dispositions", async () => {
        const { moduleManifestSchema } = await import("@/core/lib/module-manifest-schema");
        // A manifest the schema already accepts, so the only thing under
        // test is the field this round added.
        const base = JSON.parse(
            fs.readFileSync(path.join(ROOT, "module-sources/in-app-notifications/module.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(moduleManifestSchema.safeParse(base).success).toBe(true);

        const withErasure = (erasure: unknown) => ({
            ...base,
            userDataExport: [{ model: "notification", key: "notifications.items", column: "userId", erasure }],
        });

        expect(moduleManifestSchema.safeParse(withErasure("purge")).success).toBe(true);
        expect(moduleManifestSchema.safeParse(withErasure("retain")).success).toBe(true);
        expect(moduleManifestSchema.safeParse(withErasure("delete")).success).toBe(false);
        expect(moduleManifestSchema.safeParse(withErasure(true)).success).toBe(false);
        // Absent is still legal: it means retain.
        expect(
            moduleManifestSchema.safeParse({
                ...base,
                userDataExport: [{ model: "notification", key: "notifications.items", column: "userId" }],
            }).success,
        ).toBe(true);
    });
});
