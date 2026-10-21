// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { validateZipEntries } from "@/core/lib/module-zip-validator";

/**
 * An archive that becomes files on disk is checked by one set of rules.
 *
 * `validateZipEntries` is that set: it refuses a symlink, a null byte, an
 * absolute path, a `..` segment, a file type no module needs, an archive with
 * too many entries, an entry larger than 10 MB, a total over 200 MB, and a
 * compression ratio over a hundred to one, which is what a zip bomb looks
 * like from the outside.
 *
 * Seven places unpack an archive. Six called it. The setup wizard grew its
 * own smaller version instead: it refused a `..` and resolved each path back
 * under the target, which is the traversal half and the important half, but
 * it capped only the compressed size of the file it was handed. Its own
 * comment said it "uses the same validation rules as the full marketplace
 * installer", which had stopped being true.
 *
 * The archives it reads ship with the platform, so this was a divergence
 * rather than a hole. Divergences are how holes arrive: the day that path is
 * pointed at something downloaded, whoever moves it will read the comment.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Build tooling reads the archives this repository produces, from this
 * repository, to check they match their sources. It is not a trust boundary,
 * so `scripts/` is not scanned.
 */
const SCANNED = ["src/app", "src/core"];

function tsFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) tsFiles(full, out);
        else if (full.endsWith(".ts")) out.push(full);
    }
    return out;
}

describe("an archive that becomes files on disk", () => {
    it("is checked by the rules every other archive is checked by", () => {
        const unchecked: string[] = [];
        for (const base of SCANNED) {
            for (const file of tsFiles(path.join(ROOT, base))) {
                const source = fs.readFileSync(file, "utf8");
                // `new AdmZip()` with no argument builds an archive; only one
                // that is handed bytes or a path is reading someone's file.
                if (!/new AdmZip\s*\(\s*[^)\s]/.test(source)) continue;
                if (source.includes("validateZipEntries")) continue;
                unchecked.push(path.relative(ROOT, file));
            }
        }
        expect(
            unchecked,
            `these unpack an archive without the shared rules:\n${unchecked.join("\n")}`,
        ).toEqual([]);
    });

    it("is a rule set the archives this project ships all pass", () => {
        // If a module ever starts shipping a file type or a size the rules
        // refuse, the setup wizard would refuse to install it. Better to
        // learn that here than on somebody's first run.
        const dir = path.join(ROOT, "module-marketplace");
        const zips = fs.readdirSync(dir).filter((f) => f.endsWith(".zip"));
        expect(zips.length, "the marketplace should ship archives").toBeGreaterThan(10);
        const refused: string[] = [];
        for (const name of zips) {
            const zip = new AdmZip(fs.readFileSync(path.join(dir, name)));
            const result = validateZipEntries(zip.getEntries());
            if (!result.ok) refused.push(`${name}: ${result.error}`);
        }
        expect(refused, `these would be refused on a fresh install:\n${refused.join("\n")}`).toEqual([]);
    });
});
