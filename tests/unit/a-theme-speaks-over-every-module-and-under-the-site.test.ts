/**
 * A string is said by the last of four voices that has something to say:
 * core, then the module that ships it, then the theme the site is wearing,
 * then the site's own edit.
 *
 * The theme's place used to fall out of an alphabetical sort of module ids,
 * so a theme's word beat a module called "store" and lost to one called
 * "wiki", because "theme:" sorts between them. Which module a string belongs
 * to decided whether a theme could word it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
    namespace: string;
    key: string;
    value: string;
    module: string;
    isCustom: boolean;
}

const db = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("@/core/lib/db", () => ({
    prisma: {
        themeState: { findFirst: async () => ({ themeId: "kite" }) },
        moduleConfig: { findMany: async () => [] },
        translation: { findMany: async () => db.rows.map((row) => ({ ...row })) },
    },
}));
vi.mock("@/core/lib/redis", () => ({
    cacheGet: async () => null,
    cacheSet: async () => {},
    cacheDel: async () => {},
}));
vi.mock("@/core/lib/i18n/shipped-messages", () => ({ shippedMessages: () => ({}) }));

const { getMessages } = await import("@/core/lib/i18n/translation-service");

const row = (module: string, namespace: string, key: string, value: string, isCustom = false): Row => ({ module, namespace, key, value, isCustom });

beforeEach(() => {
    db.rows = [];
});

describe("who says a string", () => {
    it("is the theme over any module, whatever the module is called", async () => {
        db.rows = [
            row("theme:kite", "wiki", "title", "Bilgi"),
            row("wiki", "wiki", "title", "Wiki"),
            row("theme:kite", "anvil", "title", "Örs"),
            row("anvil", "anvil", "title", "Anvil"),
        ];
        const messages = await getMessages("tr") as Record<string, Record<string, string>>;
        expect(messages.wiki.title).toBe("Bilgi");
        expect(messages.anvil.title).toBe("Örs");
    });

    it("is the theme over core", async () => {
        db.rows = [row("theme:kite", "auth", "loginSubtitle", "Adan seni bekliyor"), row("core", "auth", "loginSubtitle", "Hesabına giriş yap")];
        const messages = await getMessages("tr") as Record<string, Record<string, string>>;
        expect(messages.auth.loginSubtitle).toBe("Adan seni bekliyor");
    });

    it("is the site over the theme, on whichever row the site edited", async () => {
        db.rows = [
            row("store", "store", "title", "Market", true),
            row("theme:kite", "store", "title", "Pazar yeri"),
            row("store", "store", "categories", "Kategoriler"),
            row("theme:kite", "store", "categories", "Bizde ne var", true),
        ];
        const messages = await getMessages("tr") as Record<string, Record<string, string>>;
        expect(messages.store.title).toBe("Market");
        expect(messages.store.categories).toBe("Bizde ne var");
    });
});
