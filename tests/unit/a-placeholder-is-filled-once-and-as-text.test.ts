/**
 * A site placeholder in a sentence an operator wrote: `{servers.online}`.
 *
 * Filled once, left to right, and what goes in is text: a value that itself
 * reads `{site.name}` stays those characters, so a server's message of the
 * day or a member's name can never pull another value in. A token that names
 * nothing this site answers shows its fallback, because a visitor should not
 * read the braces an operator typed; anything that is not a token at all, an
 * event's `{player}` among them, is left exactly as written.
 */
import { describe, it, expect } from "vitest";
import { fillPlaceholderText, placeholderTokens, PLACEHOLDER_FALLBACK } from "@/core/lib/placeholder-text";

const plain = (value: number) => String(value);

describe("a site placeholder", () => {
    it("is replaced by its value, numbers as the reader writes them", () => {
        const thousands = (value: number) => new Intl.NumberFormat("tr").format(value);
        expect(fillPlaceholderText("Şu an {servers.online} kişi", { "servers.online": 1234 }, thousands))
            .toBe("Şu an 1.234 kişi");
        expect(fillPlaceholderText("{site.name} sunucusu", { "site.name": "Kayadibi" }, plain)).toBe("Kayadibi sunucusu");
    });

    it("shows its fallback when it has no value, or when nothing answers it", () => {
        expect(fillPlaceholderText("{servers.online} kişi", { "servers.online": null }, plain)).toBe(`${PLACEHOLDER_FALLBACK} kişi`);
        expect(fillPlaceholderText("{servers.online} kişi", {}, plain)).toBe(`${PLACEHOLDER_FALLBACK} kişi`);
        expect(fillPlaceholderText("{servers.online|birkaç} kişi", { "servers.online": null }, plain)).toBe("birkaç kişi");
        expect(fillPlaceholderText("{servers.online|birkaç} kişi", { "servers.online": 3 }, plain)).toBe("3 kişi");
    });

    it("puts in what a value says, and never reads it again", () => {
        expect(fillPlaceholderText("MOTD: {servers.motd}", { "servers.motd": "{site.name} <b>hi</b>", "site.name": "X" }, plain))
            .toBe("MOTD: {site.name} <b>hi</b>");
    });

    it("leaves alone what is not a site placeholder", () => {
        const text = "{player} bought {product}, version {v1.2}, {Servers.online}, {servers.}, { servers.online }";
        expect(fillPlaceholderText(text, { "servers.online": 5 }, plain)).toBe(text);
    });

    it("names the tokens a text holds, with the fallback each carries", () => {
        expect(placeholderTokens("{help-center.articles} and {servers.online|0} and {player}")).toEqual([
            { name: "help-center.articles", fallback: null },
            { name: "servers.online", fallback: "0" },
        ]);
    });
});
