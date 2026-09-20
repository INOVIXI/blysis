// @vitest-environment node
/**
 * A string with an angle bracket in it is markup or it is a mistake.
 *
 * next-intl parses `<name>...</name>` as rich text, which is how three core
 * strings put a username in bold. It parses `<tenant-id>` the same way, finds
 * no closing tag, and throws: the screen logs `INVALID_MESSAGE: UNCLOSED_TAG`
 * and renders the key instead of the sentence. Measured on 2026-09-20,
 * `/admin/settings/microsoft-auth` did exactly that - a note telling an
 * operator what to set, replaced by an error, because it wrote a placeholder
 * the way a shell manual does.
 *
 * So a tag has to be closed. What it is called is not this gate's business -
 * a module may invent one and render it with `t.rich` - but an opening
 * without a closing is never anything but a broken sentence.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OPENING = /<([a-zA-Z][\w-]*)>/g;

function catalogues(): { where: string; values: [string, string][] }[] {
    const out: { where: string; values: [string, string][] }[] = [];

    const flatten = (obj: unknown, prefix: string, into: [string, string][]) => {
        if (typeof obj === "string") { into.push([prefix, obj]); return; }
        if (!obj || typeof obj !== "object") return;
        for (const [key, value] of Object.entries(obj)) {
            flatten(value, prefix ? `${prefix}.${key}` : key, into);
        }
    };

    for (const locale of ["en", "tr"]) {
        const values: [string, string][] = [];
        flatten(JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8")), "", values);
        out.push({ where: `messages-core/${locale}.json`, values });
    }

    const modules = path.join(ROOT, "module-sources");
    for (const id of fs.readdirSync(modules)) {
        const manifest = path.join(modules, id, "module.json");
        if (!fs.existsSync(manifest)) continue;
        const values: [string, string][] = [];
        flatten(JSON.parse(fs.readFileSync(manifest, "utf8")).translations ?? {}, "", values);
        out.push({ where: `${id}/module.json`, values });
    }
    return out;
}

describe("a translated string", () => {
    const all = catalogues();

    it("finds the catalogues", () => {
        expect(all.length).toBeGreaterThan(50);
        expect(all.reduce((n, c) => n + c.values.length, 0)).toBeGreaterThan(5_000);
    });

    it("closes every tag it opens, or it is not a sentence", () => {
        const broken: string[] = [];
        for (const { where, values } of all) {
            for (const [key, value] of values) {
                for (const [, tag] of value.matchAll(OPENING)) {
                    if (!value.includes(`</${tag}>`)) broken.push(`${where}: ${key} opens <${tag}> and never closes it`);
                }
            }
        }
        expect(broken).toEqual([]);
    });
});
