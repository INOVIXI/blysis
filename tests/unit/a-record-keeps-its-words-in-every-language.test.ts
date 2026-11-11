// @vitest-environment node
/**
 * A module's record keeps the text the admin typed in its own column and a
 * translation per language beside it, in core's `ContentTranslation` table.
 *
 * What these hold: a page of rows is translated with one query whatever its
 * length; a reader whose language has no translation, or a blank one, reads
 * the original; a save replaces only the fields it names; a deleted record
 * takes its translations with it; and what an admin sends is checked before
 * any of it is written.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { fakeTable } from "../modules/game-connect/fake-prisma";
import {
    attachContentTranslations,
    contentTranslationsInput,
    deleteContentTranslations,
    readContentTranslations,
    saveContentTranslations,
    translateContent,
} from "@/core/lib/content-translations";
import { joinTranslations, splitTranslations } from "@/core/lib/i18n/translatable-text";

const PAGE = { owner: "pages", entity: "page" };

function fakeDb() {
    const contentTranslation = fakeTable(
        () => ({ updatedAt: new Date() }),
        "id",
        [["owner", "entity", "recordId", "field", "locale"]],
    );
    return { contentTranslation };
}

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
    db = fakeDb();
});

async function seed(recordId: string, field: string, locale: string, text: string, owner = PAGE.owner, entity = PAGE.entity) {
    await db.contentTranslation.create({ data: { owner, entity, recordId, field, locale, text } });
}

describe("reading a page of records in the reader's language", () => {
    it("asks the table once for the whole page, not once a row", async () => {
        const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, title: `Başlık ${i}` }));
        await seed("r3", "title", "en", "Title 3");

        const out = await translateContent(db as never, PAGE, rows, ["title"], "en");

        expect(db.contentTranslation.findMany).toHaveBeenCalledTimes(1);
        expect(out[3].title).toBe("Title 3");
        expect(out[4].title).toBe("Başlık 4");
    });

    it("gives the reader their own translation, and the original to a language with none", async () => {
        const rows = [{ id: "a", title: "Kurallar", content: "Kural metni" }];
        await seed("a", "title", "en", "Rules");
        await seed("a", "content", "en", "The rules");
        await seed("a", "title", "de", "Regeln");

        expect(await translateContent(db as never, PAGE, rows, ["title", "content"], "tr")).toEqual(rows);
        expect(await translateContent(db as never, PAGE, rows, ["title", "content"], "en")).toEqual([
            { id: "a", title: "Rules", content: "The rules" },
        ]);
        expect(await translateContent(db as never, PAGE, rows, ["title", "content"], "de")).toEqual([
            { id: "a", title: "Regeln", content: "Kural metni" },
        ]);
        expect(await translateContent(db as never, PAGE, rows, ["title", "content"], "fr")).toEqual(rows);
    });

    it("reads a blank translation as none", async () => {
        await seed("a", "title", "en", "   ");
        const out = await translateContent(db as never, PAGE, [{ id: "a", title: "Kurallar" }], ["title"], "en");
        expect(out[0].title).toBe("Kurallar");
    });

    it("reads only its own module's and its own kind's rows", async () => {
        await seed("a", "title", "en", "Other module", "store", "page");
        await seed("a", "title", "en", "Other kind", "pages", "category");
        const out = await translateContent(db as never, PAGE, [{ id: "a", title: "Kurallar" }], ["title"], "en");
        expect(out[0].title).toBe("Kurallar");
    });

    it("leaves a field it was not asked about alone, and the rows' order and other columns", async () => {
        await seed("b", "slug", "en", "should-not-move");
        const rows = [{ id: "b", title: "İki", slug: "iki", order: 2 }, { id: "a", title: "Bir", slug: "bir", order: 1 }];
        const out = await translateContent(db as never, PAGE, rows, ["title"], "en");
        expect(out).toEqual(rows);
    });

    it("does not ask at all for an empty page or a reader with no language", async () => {
        await translateContent(db as never, PAGE, [], ["title"], "en");
        await translateContent(db as never, PAGE, [{ id: "a", title: "x" }], ["title"], "");
        expect(db.contentTranslation.findMany).not.toHaveBeenCalled();
    });

    it("leaves a null column null whatever is stored for it", async () => {
        await seed("a", "description", "en", "A description");
        const out = await translateContent(db as never, PAGE, [{ id: "a", description: null as string | null }], ["description"], "en");
        expect(out[0].description).toBe("A description");
    });
});

describe("what the admin's editor is given", () => {
    it("every language of every field, per record, in one query", async () => {
        await seed("a", "title", "en", "Rules");
        await seed("a", "title", "de", "Regeln");
        await seed("b", "content", "en", "Body");

        const read = await readContentTranslations(db as never, PAGE, ["a", "b", "c"]);
        expect(db.contentTranslation.findMany).toHaveBeenCalledTimes(1);
        expect(read.get("a")).toEqual({ title: { en: "Rules", de: "Regeln" } });
        expect(read.get("b")).toEqual({ content: { en: "Body" } });
        expect(read.get("c")).toBeUndefined();
    });

    it("rides on the rows as `translations`, empty for a record nobody translated", async () => {
        await seed("a", "title", "en", "Rules");
        const rows = await attachContentTranslations(db as never, PAGE, [{ id: "a", title: "Kurallar" }, { id: "b", title: "Yeni" }]);
        expect(rows).toEqual([
            { id: "a", title: "Kurallar", translations: { title: { en: "Rules" } } },
            { id: "b", title: "Yeni", translations: {} },
        ]);
    });
});

describe("saving", () => {
    it("replaces the languages of each field it names and leaves the others", async () => {
        await seed("a", "title", "en", "Old");
        await seed("a", "title", "de", "Alt");
        await seed("a", "content", "en", "Body");

        await saveContentTranslations(db as never, { ...PAGE, recordId: "a" }, { title: { en: "Rules", fr: "Règles" } });

        const read = await readContentTranslations(db as never, PAGE, ["a"]);
        expect(read.get("a")).toEqual({ title: { en: "Rules", fr: "Règles" }, content: { en: "Body" } });
    });

    it("clears a field sent with no languages", async () => {
        await seed("a", "title", "en", "Old");
        await saveContentTranslations(db as never, { ...PAGE, recordId: "a" }, { title: {} });
        expect((await readContentTranslations(db as never, PAGE, ["a"])).get("a")).toBeUndefined();
    });

    it("never writes a blank translation", async () => {
        await saveContentTranslations(db as never, { ...PAGE, recordId: "a" }, { title: { en: "  ", de: "Regeln" } });
        expect(db.contentTranslation.table.rows.map((r) => r.locale)).toEqual(["de"]);
    });
});

describe("deleting", () => {
    it("takes every translation of the deleted records and nothing else", async () => {
        await seed("a", "title", "en", "A");
        await seed("a", "content", "de", "A");
        await seed("b", "title", "en", "B");
        await seed("a", "title", "en", "Another module's a", "store", "page");

        await deleteContentTranslations(db as never, PAGE, ["a"]);

        const left = db.contentTranslation.table.rows.map((r) => `${r.owner}/${r.recordId}`);
        expect(left.sort()).toEqual(["pages/b", "store/a"]);
    });

    it("does nothing for no records", async () => {
        await seed("a", "title", "en", "A");
        await deleteContentTranslations(db as never, PAGE, []);
        expect(db.contentTranslation.table.rows).toHaveLength(1);
    });
});

describe("what an admin sends", () => {
    const LIMITS = { title: 200, content: 10_000 };

    it("is absent when the body says nothing about translations", () => {
        expect(contentTranslationsInput(undefined, LIMITS)).toEqual({ ok: true, value: undefined });
    });

    it("keeps the languages the software ships and drops blanks", () => {
        expect(contentTranslationsInput({ title: { en: "Rules", xx: "?", de: " " } }, LIMITS)).toEqual({
            ok: true,
            value: { title: { en: "Rules" } },
        });
    });

    it("keeps a field sent with nothing in it, since that is how a field is cleared", () => {
        expect(contentTranslationsInput({ title: {} }, LIMITS)).toEqual({ ok: true, value: { title: {} } });
    });

    it("refuses a field the record does not translate", () => {
        expect(contentTranslationsInput({ slug: { en: "x" } }, LIMITS).ok).toBe(false);
    });

    it("refuses a translation longer than the column's own limit", () => {
        expect(contentTranslationsInput({ title: { en: "x".repeat(201) } }, LIMITS).ok).toBe(false);
    });

    it("refuses anything that is not text", () => {
        expect(contentTranslationsInput("en", LIMITS).ok).toBe(false);
        expect(contentTranslationsInput({ title: "Rules" }, LIMITS).ok).toBe(false);
        expect(contentTranslationsInput({ title: { en: 3 } }, LIMITS).ok).toBe(false);
        expect(contentTranslationsInput([], LIMITS).ok).toBe(false);
    });
});

describe("the editor's value and the record's columns", () => {
    it("joins an original and its translations into the value the editor takes", () => {
        expect(joinTranslations("Kurallar", { en: "Rules" })).toEqual({ default: "Kurallar", en: "Rules" });
        expect(joinTranslations("Kurallar", {})).toBe("Kurallar");
        expect(joinTranslations("Kurallar", undefined)).toBe("Kurallar");
        expect(joinTranslations("Kurallar", { en: " " })).toBe("Kurallar");
    });

    it("splits the editor's value back into the column and the translations", () => {
        expect(splitTranslations({ default: "Kurallar", en: "Rules", de: "" })).toEqual({ original: "Kurallar", translations: { en: "Rules" } });
        expect(splitTranslations("Kurallar")).toEqual({ original: "Kurallar", translations: {} });
        expect(splitTranslations(undefined)).toEqual({ original: "", translations: {} });
    });
});
