// @vitest-environment node
/**
 * A string the site says can carry a live value, `{servers.online}`, as the
 * theme's texts already could.
 *
 * Site placeholders reached the texts an operator writes on a theme's
 * settings screen and nowhere else, so "{count} players online" in the
 * site's own words could not say how many: the translation editor refused
 * the token as a value nothing passes, and had it been stored, the formatter
 * would have read it as a blank and failed the string. The catalogue a page
 * is given now has each token filled with what it says at that moment, as
 * text the formatter cannot mistake for syntax, and the edit check accepts a
 * placeholder this site answers while still refusing one it does not.
 */
import { describe, it, expect, vi } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";

vi.mock("@/core/lib/placeholders", () => ({
    resolvePlaceholders: vi.fn(async () => ({ values: { "servers.online": 1234, "site.name": "Kaya'nın {yeri}" }, pending: [] })),
}));

import { catalogueTokens, fillCatalogue, withLiveValues } from "@/core/lib/i18n/catalogue-placeholders";
import { resolvePlaceholders } from "@/core/lib/placeholders";
import { checkMessageEdit } from "@/core/lib/message-edit";

const format = (message: string, values: Record<string, unknown> = {}) =>
    new IntlMessageFormat(message, "en").format(values) as string;

describe("a catalogue with live values in it", () => {
    const catalogue = {
        hero: { online: "{servers.online} players on {site.name}", count: "{count, plural, one {# reply} other {# replies}}" },
        footer: { plain: "Nothing to fill" },
    };

    it("names the values its strings ask for", () => {
        expect([...catalogueTokens(catalogue)].sort()).toEqual(["servers.online", "site.name"]);
    });

    it("is filled as text the formatter reads as text, and leaves the values the code passes", () => {
        const filled = fillCatalogue(catalogue, { "servers.online": 1234, "site.name": "Kaya'nın {yeri}" }, "en") as typeof catalogue;
        expect(format(filled.hero.online)).toBe("1,234 players on Kaya'nın {yeri}");
        expect(format(filled.hero.count, { count: 2 })).toBe("2 replies");
        expect(filled.footer.plain).toBe("Nothing to fill");
    });

    it("says the token's own fallback, or a dash, when there is no value", () => {
        const filled = fillCatalogue({ a: { b: "{servers.online|a few} on" } }, {}, "en") as { a: { b: string } };
        expect(format(filled.a.b)).toBe("a few on");
    });

    it("asks for no values at all when no string names one", async () => {
        vi.mocked(resolvePlaceholders).mockClear();
        const plain = { a: { b: "Hello {name}" } };
        expect(await withLiveValues(plain, "en")).toBe(plain);
        expect(resolvePlaceholders).not.toHaveBeenCalled();
        const filled = await withLiveValues(catalogue, "tr") as typeof catalogue;
        expect(format(filled.hero.online)).toBe("1.234 players on Kaya'nın {yeri}");
    });
});

describe("an edit that names a live value", () => {
    const site = new Set(["servers.online", "site.name"]);

    it("is accepted when this site answers it", () => {
        expect(checkMessageEdit("Players", "Players: {servers.online}", site)).toBeNull();
        expect(checkMessageEdit("{count} players", "{count} of {servers.online|many}", site)).toBeNull();
    });

    it("is refused, by name, when nothing on this site answers it", () => {
        expect(checkMessageEdit("Players", "Players: {servers.onlin}", site)).toEqual({ reason: "new_placeholder", names: ["servers.onlin"] });
        expect(checkMessageEdit("Players", "Players: {servers.online}")).toEqual({ reason: "new_placeholder", names: ["servers.online"] });
    });
});
