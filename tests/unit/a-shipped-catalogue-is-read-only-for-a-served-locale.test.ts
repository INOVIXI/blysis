// @vitest-environment node
/**
 * Only a locale the site serves names a file the catalogue reader opens.
 *
 * `shippedMessages` joined whatever locale it was handed into a path under
 * `messages-core/`. Every caller today has already held the locale to the
 * served list, but the reader trusted that: `../package` opened the
 * repository's `package.json` and handed it back as a catalogue. The reader
 * now refuses a locale it does not serve, whoever calls it next.
 * CodeQL `js/path-injection` (#79) flagged the join.
 */
import { describe, it, expect } from "vitest";
import { shippedMessages } from "@/core/lib/i18n/shipped-messages";

describe("reading the catalogue a version ships", () => {
    it("reads a served locale", () => {
        expect(Object.keys(shippedMessages("tr")).length).toBeGreaterThan(0);
    });

    it("opens nothing outside the catalogue for a locale that climbs out of it", () => {
        expect(shippedMessages("../package")).toEqual({});
    });

    it("opens nothing for a locale the site does not serve", () => {
        expect(shippedMessages("xx")).toEqual({});
    });
});
