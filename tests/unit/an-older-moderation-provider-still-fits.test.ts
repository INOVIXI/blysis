import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A moderation provider written before the Rejected view and the author's
 * page still compiles and still works.
 *
 * `listRejected` and `read` came after `count`, `list` and `bulkUpdate`, and a
 * module outside this tree may implement only those three. Core treats a
 * provider without them as one with no Rejected view and nobody to tell, so
 * the generated interface has to keep them optional: a required member would
 * fail that module's build on a core update it did nothing to deserve.
 */

const generator = fs.readFileSync(path.join(process.cwd(), "scripts/generate-registry.ts"), "utf8");
const contract = generator.slice(generator.indexOf("export interface ModerationProvider"));

describe("the moderation provider contract", () => {
    it("is found where the registry generator writes it", () => {
        expect(contract.length).toBeGreaterThan(0);
        expect(contract).toContain("bulkUpdate(");
    });

    it("keeps what came later optional", () => {
        expect(contract).toContain("listRejected?(");
        expect(contract).toContain("read?(");
        expect(contract).not.toMatch(/\blistRejected\(/);
        expect(contract).not.toMatch(/\bread\(/);
    });
});
