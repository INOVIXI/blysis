// @vitest-environment node
/**
 * Nothing reaches a marketplace ZIP that is not in the repository.
 *
 * `scripts/build-marketplace.sh` walks `module-sources/<id>/` off disk, so it
 * packs whatever is sitting there - including a file somebody is still
 * working on. The archive is a published artifact: an operator installs it
 * and runs the code inside, and a reader of this repository cannot see that
 * code at all.
 *
 * It has happened. A store ZIP was committed carrying `lib/upgrade-credit.ts`,
 * `lib/cart-pricing.ts`, two comparison libraries and two migrations, none of
 * which were tracked. The tip was consistent again a commit later, but only
 * because somebody noticed.
 *
 * `check-marketplace-sync.ts` compares an archive against the sources on
 * disk, which is the other half and cannot see this one: the ZIP and the
 * working tree agreed perfectly.
 *
 * A module's own build output is not the subject. Every path this checks is
 * one a human wrote.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import AdmZip from "adm-zip";

const ROOT = process.cwd();
const ARCHIVES = path.join(ROOT, "module-marketplace");

/** Every file git has under module-sources, as `<id>/<path within module>`. */
function tracked(): Set<string> {
    const listing = execFileSync("git", ["ls-files", "-z", "module-sources"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    });
    const out = new Set<string>();
    for (const line of listing.split("\0")) {
        if (!line) continue;
        out.add(line.slice("module-sources/".length));
    }
    return out;
}

const zips = fs.existsSync(ARCHIVES)
    ? fs.readdirSync(ARCHIVES).filter((name) => name.endsWith(".zip")).sort()
    : [];

describe("a published module archive", () => {
    it("finds the archives and the sources", () => {
        expect(zips.length).toBeGreaterThan(50);
        expect(tracked().size).toBeGreaterThan(500);
    });

    it("holds only files this repository has", () => {
        const known = tracked();
        const strangers: string[] = [];

        for (const name of zips) {
            const id = name.replace(/\.zip$/, "");
            for (const entry of new AdmZip(path.join(ARCHIVES, name)).getEntries()) {
                if (entry.isDirectory) continue;
                const inRepo = `${id}/${entry.entryName}`;
                if (!known.has(inRepo)) strangers.push(`${name}: ${entry.entryName}`);
            }
        }

        expect(
            strangers,
            "these are published and not in the repository. Commit the source, or rebuild the ZIP without it",
        ).toEqual([]);
    });

    it("exists for every module the sources hold", () => {
        const ids = new Set([...tracked()].map((file) => file.split("/")[0]));
        const published = new Set(zips.map((name) => name.replace(/\.zip$/, "")));
        const missing = [...ids].filter((id) => !published.has(id)).sort();

        expect(missing, "a module nobody can install").toEqual([]);
    });
});
