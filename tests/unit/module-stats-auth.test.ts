import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * A module's `statsApi` is what the admin dashboard and the analytics screen
 * read: order counts, revenue, the newest support tickets with the usernames
 * on them. It is admin data by definition, and it is served by a GET, which
 * the write-only auth check in scripts/validate-module.ts used to walk past.
 *
 * Four first-party modules shipped it open to anyone. `validate-module` fails
 * on it now; this runs the same rule under `npm test`, where a regression
 * shows up without waiting for the module gate.
 */

const root = path.resolve(import.meta.dirname, "../..");
const sourcesDir = path.join(root, "module-sources");

interface Manifest {
    statsApi?: string;
    api?: { path: string; handler: string }[];
}

function modulesWithStatsApi(): { id: string; manifest: Manifest }[] {
    return fs
        .readdirSync(sourcesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({
            id: e.name,
            manifestPath: path.join(sourcesDir, e.name, "module.json"),
        }))
        .filter((m) => fs.existsSync(m.manifestPath))
        .map((m) => ({ id: m.id, manifest: JSON.parse(fs.readFileSync(m.manifestPath, "utf8")) as Manifest }))
        .filter((m) => Boolean(m.manifest.statsApi));
}

describe("module statsApi handlers", () => {
    const modules = modulesWithStatsApi();

    it("finds the modules it is meant to be checking", () => {
        expect(modules.map((m) => m.id).sort()).toEqual(["ai-moderation", "blog", "forum", "store", "tickets"]);
    });

    it.each(modules.map((m) => m.id))("%s checks for an admin before answering", (id) => {
        const { manifest } = modules.find((m) => m.id === id)!;
        const entry = manifest.api?.find((a) => a.path === manifest.statsApi);
        expect(entry, `${id}: statsApi ${manifest.statsApi} is not a declared api route`).toBeDefined();

        const handler = path.join(sourcesDir, id, entry!.handler);
        expect(fs.existsSync(handler), `${id}: missing handler ${entry!.handler}`).toBe(true);

        const source = fs.readFileSync(handler, "utf8");
        const guarded = ["isAdmin(", "isStaff(", "hasPermission("].some((marker) => source.includes(marker));
        expect(guarded, `${id}: ${entry!.handler} answers anyone`).toBe(true);
    });
});
