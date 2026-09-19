import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { staleTranslations } from "../../scripts/seed-translations";

/**
 * A string the app no longer ships stops being a string an operator can
 * translate.
 *
 * The app reads its wording from the database, and the seeder only ever
 * upserted, so every key ever shipped stayed in the table for the life of an
 * installation. Nothing rendered them - nothing asks for a key that no longer
 * exists - but the translations screen lists what is in the table, so an
 * operator sat in front of a list that included strings no page could show.
 * Measured when `siteSettings_serverIp` was deleted from core: 83 core keys
 * and 60-odd module keys were already stranded.
 *
 * A row an operator has edited is their own text. Deleting it because the key
 * moved would throw away work without asking, so the sweep is limited to the
 * rows the seeder itself wrote; a stranded custom belongs on the translations
 * screen, where somebody can decide.
 */

describe("a key the catalogue has dropped", () => {
    const shipped = [
        { namespace: "admin", key: "footer_aboutTextPlaceholder" },
        { namespace: "common", key: "save" },
    ];

    it("is named by its namespace and its key together", () => {
        // Comparing on the key alone would keep a row whose namespace moved
        // and delete one that merely shares a key with something else.
        const stored = [
            { id: "1", namespace: "common", key: "footer_aboutTextPlaceholder" },
            { id: "2", namespace: "admin", key: "footer_aboutTextPlaceholder" },
        ];
        expect(staleTranslations(shipped, stored).map((r) => r.id)).toEqual(["1"]);
    });

    it("is returned when the catalogue no longer carries it", () => {
        const stored = [{ id: "1", namespace: "admin", key: "siteSettings_serverIp" }];
        expect(staleTranslations(shipped, stored)).toHaveLength(1);
    });

    it("keeps everything the catalogue still carries", () => {
        const stored = [
            { id: "1", namespace: "admin", key: "footer_aboutTextPlaceholder" },
            { id: "2", namespace: "common", key: "save" },
        ];
        expect(staleTranslations(shipped, stored)).toEqual([]);
    });

    it("removes nothing when a locale ships nothing, which is a failed read", () => {
        // A guard rather than a nicety: an empty catalogue would otherwise
        // mean every string on the site is stale.
        const stored = [{ id: "1", namespace: "admin", key: "save" }];
        expect(staleTranslations([], stored)).toEqual([]);
    });
});

describe("the sweep itself", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/seed-translations.ts"), "utf8");

    it("reads only the rows it wrote, so an operator's own text survives", () => {
        const read = source.slice(source.indexOf("const stored = await prisma.translation.findMany"));
        expect(read.slice(0, 300)).toContain("isCustom: false");
    });

    it("is scoped to the locale and the module it just seeded", () => {
        const read = source.slice(source.indexOf("const stored = await prisma.translation.findMany"));
        expect(read.slice(0, 300)).toContain("locale, module: moduleId");
    });
});
