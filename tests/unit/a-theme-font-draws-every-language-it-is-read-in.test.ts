import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { locales } from "@/core/lib/i18n/config";

/**
 * A theme that brings its own typefaces draws every language the site speaks with them.
 *
 * Vanguard shipped Chakra Petch for headings and Figtree for text, and neither
 * has Cyrillic, so a Russian page set its headings in whatever the visitor's
 * system had: Outfit, the next name in the stack, has no Cyrillic either.
 * Figtree also has no "ə", "₺" or "₽", so an Azerbaijani word or a Turkish
 * price changed typeface halfway through.
 *
 * So every letter and currency sign a locale's catalogue uses has to be in one
 * of the faces the theme names in that stack. Chinese is the one exception:
 * no theme carries a CJK face, which runs to megabytes, and the browser's own
 * is what every site in that language is read in.
 *
 * The coverage is read from the font files themselves. A WOFF2 file keeps its
 * `cmap` table untransformed inside the brotli stream, so this needs nothing
 * but zlib.
 */

const ROOT = process.cwd();
const THEMES = path.join(ROOT, "src/themes");
const NOT_CARRIED: Record<string, string> = {
    zh: "no theme ships a CJK face; it is the browser's to draw",
};

/** UIntBase128 from the WOFF2 table directory. */
function base128(buf: Buffer, at: { pos: number }): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
        const byte = buf[at.pos++];
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return value;
    }
    throw new Error("UIntBase128 longer than five bytes");
}

const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep"];

/** The code points a WOFF2 file maps to a real glyph. */
export function codePoints(file: string): Set<number> {
    const buf = fs.readFileSync(file);
    if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${file} is not WOFF2`);
    const numTables = buf.readUInt16BE(12);
    const at = { pos: 48 };
    const tables: { tag: string; length: number }[] = [];
    for (let i = 0; i < numTables; i++) {
        const flags = buf[at.pos++];
        let tag = KNOWN_TAGS[flags & 0x3f];
        if ((flags & 0x3f) === 63) {
            tag = buf.toString("latin1", at.pos, at.pos + 4);
            at.pos += 4;
        }
        const transform = flags >> 6;
        const origLength = base128(buf, at);
        // glyf and loca are transformed unless the version says null (3);
        // every other table is transformed only when the version is not 0.
        const transformed = tag === "glyf" || tag === "loca" ? transform !== 3 : transform !== 0;
        const length = transformed ? base128(buf, at) : origLength;
        tables.push({ tag, length });
    }
    const stream = zlib.brotliDecompressSync(buf.subarray(at.pos));
    let offset = 0;
    let cmap: Buffer | null = null;
    for (const table of tables) {
        if (table.tag === "cmap") cmap = stream.subarray(offset, offset + table.length);
        offset += table.length;
    }
    if (!cmap) throw new Error(`${file} has no cmap`);

    const found = new Set<number>();
    const records = cmap.readUInt16BE(2);
    for (let r = 0; r < records; r++) {
        const sub = cmap.subarray(cmap.readUInt32BE(4 + r * 8 + 4));
        const format = sub.readUInt16BE(0);
        if (format === 12) {
            const groups = sub.readUInt32BE(12);
            for (let g = 0; g < groups; g++) {
                const start = sub.readUInt32BE(16 + g * 12);
                const end = sub.readUInt32BE(20 + g * 12);
                for (let c = start; c <= end; c++) found.add(c);
            }
        } else if (format === 4) {
            const segs = sub.readUInt16BE(6) / 2;
            const ends = 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
            for (let s = 0; s < segs; s++) {
                const end = sub.readUInt16BE(ends + s * 2), start = sub.readUInt16BE(starts + s * 2);
                const delta = sub.readInt16BE(deltas + s * 2), range = sub.readUInt16BE(ranges + s * 2);
                for (let c = start; c <= end && c !== 0xffff; c++) {
                    const glyph = range === 0
                        ? (c + delta) & 0xffff
                        : sub.readUInt16BE(ranges + s * 2 + range + (c - start) * 2);
                    if (glyph !== 0) found.add(c);
                }
            }
        }
    }
    return found;
}

/**
 * The money a reader of each locale most likely pays in. A price is formatted
 * rather than written in a catalogue, so its sign is in none of them: a shop
 * in Turkish prices in lira, and "₺" fell out of the face beside the digits.
 */
const HOME_CURRENCY: Record<string, string> = {
    en: "USD", tr: "TRY", az: "AZN", de: "EUR", es: "EUR", et: "EUR",
    fr: "EUR", it: "EUR", pl: "PLN", pt: "EUR", ru: "RUB", zh: "CNY",
};

/** Every letter and currency sign a locale's own catalogue and prices use. */
function charactersOf(locale: string): Set<number> {
    const catalogue = fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8");
    const price = new Intl.NumberFormat(locale, { style: "currency", currency: HOME_CURRENCY[locale] }).format(1234.5);
    return new Set([...`${catalogue}${price}`.matchAll(/[\p{L}\p{Sc}]/gu)].map((m) => m[0].codePointAt(0)!));
}

interface Theme {
    id: string;
    fontFiles: Record<string, { file: string }[]>;
    stacks: Record<string, string>;
}

function themesWithFonts(): Theme[] {
    return fs.readdirSync(THEMES)
        .map((id) => path.join(THEMES, id, "theme.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")))
        .filter((theme) => theme.fontFiles)
        .map((theme) => ({
            id: theme.id,
            fontFiles: theme.fontFiles,
            stacks: Object.fromEntries(Object.entries(theme.tokens?.fonts ?? {})
                .map(([role, token]) => [role, (token as { default: string }).default])),
        }));
}

describe("a theme font draws every language it is read in", () => {
    const themes = themesWithFonts();

    it("finds a theme that brings its own faces", () => {
        expect(themes.length).toBeGreaterThan(0);
    });

    it("reads a face's coverage from the file", () => {
        // Figtree draws "a" and has no Cyrillic: the reader has to know both.
        const figtree = codePoints(path.join(THEMES, "vanguard/fonts/Figtree-Variable.woff2"));
        expect(figtree.has(0x61)).toBe(true);
        expect(figtree.has(0x416)).toBe(false);
    });

    for (const theme of themes) {
        for (const [role, stack] of Object.entries(theme.stacks)) {
            const families = [...stack.matchAll(new RegExp(`--font-${theme.id}-([A-Za-z0-9_-]+)`, "g"))].map((m) => m[1]);
            if (families.length === 0) continue;

            it(`${theme.id} ${role}: every locale's letters are in the theme's own faces`, () => {
                const drawn = new Set<number>();
                for (const family of families) {
                    for (const face of theme.fontFiles[family] ?? []) {
                        for (const c of codePoints(path.join(THEMES, theme.id, face.file))) drawn.add(c);
                    }
                }
                const missing: string[] = [];
                for (const locale of locales) {
                    if (NOT_CARRIED[locale]) continue;
                    const lacking = [...charactersOf(locale)].filter((c) => !drawn.has(c));
                    if (lacking.length > 0) missing.push(`${locale}: ${String.fromCodePoint(...lacking)}`);
                }
                expect(missing).toEqual([]);
            });
        }
    }
});
