import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A Turkish admin is told what happened in Turkish.
 *
 * The site ships two locales and every screen is translated, so the English
 * that survived hid in the places nobody rereads: what a failed write says,
 * what a field suggests before it is filled, and what a browser dialog asks.
 * A Turkish admin working through a Turkish panel met "Something went wrong",
 * "Failed to create product" and a native `prompt()` box with an English
 * question in it - not because those screens were untranslated, but because
 * those particular sentences were never keys.
 *
 * Two shapes produced most of them.
 *
 * `data.error || t("saveFailed")` reads as a translated fallback and is the
 * opposite: `error` is the server's own English sentence, so the fallback is
 * reached only when the endpoint says nothing. Twenty-one of these had an
 * English literal in the fallback slot as well, which is what made them
 * visible. `writeError` in the SDK exists for exactly this and explains why.
 *
 * `window.prompt()` cannot be translated, styled or dismissed by keyboard the
 * way the rest of the panel can. Two screens collected a ban reason and a
 * rejection reason through it. `usePrompt` from `@/core/sdk/ui` is the
 * in-page equivalent and is what they use now.
 *
 * The dates go with the language: `toLocaleDateString()` with no argument
 * reads the *server's* locale during SSR and the browser's afterwards, so the
 * same row rendered two different dates depending on who drew it.
 * `useLocalDate` takes the site locale and is the only place that call is
 * allowed to appear.
 */

const ROOT = process.cwd();
const DIRS = ["src/app", "src/core", "module-sources"];

/**
 * English that is not addressed to the reader in their language, with the
 * reason it stays. Each entry is a decision, not a backlog.
 */
const STAYS_IN_ENGLISH: Record<string, string> = {
    "module-sources/discord-integration/pages/admin/page.tsx":
        "The body of the test webhook, which is posted to Discord rather than rendered on any page of this site.",
};

/** Attributes and option fields whose value is read by a person. */
const READER_FACING =
    /\b(placeholder|alt|aria-label|title|message|confirmText|cancelText|defaultValue)\s*[:=]\s*(["'])((?:[^"'\\]|\\.){3,})\2/g;

/**
 * Two or more words. A single word is not evidence of English: almost every
 * one of them here is a proper noun a translation would have to keep anyway -
 * "Discord", "Instagram", "Notch" as the example Minecraft name, "Test" as a
 * gateway's literal sandbox username.
 */
function looksLikeProse(text: string): boolean {
    return /[a-z]{2,}\s+[A-Za-z]/.test(text);
}

function walk(dir: string, out: string[] = []): string[] {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return out;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel, out);
        else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(rel);
    }
    return out;
}

const FILES = DIRS.flatMap((d) => walk(d));

function read(file: string): string {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/** The file with block comments and line comments removed. */
function code(file: string): string {
    return stripComments(read(file));
}

/**
 * The string literals inside a JSX expression attribute, starting just after
 * its opening brace and stopping at the brace that closes it.
 */
function literalsIn(src: string, start: number): string[] {
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
    }
    const expression = src.slice(start, i - 1);
    return [...expression.matchAll(/(["'])((?:[^"'\\]|\\.){3,})\1/g)].map((m) => m[2]);
}

describe("the reader is addressed in their language", () => {
    it("no screen asks a question through a browser dialog", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            const src = code(file);
            // `confirm(` on its own is the SDK hook, which is the wanted
            // shape. The window-scoped calls are the native boxes.
            const native = /\bwindow\.(prompt|confirm|alert)\s*\(|(?<![.\w])(prompt|alert)\s*\(\s*["'`]/g;
            for (const m of src.matchAll(native)) {
                offenders.push(`${file}: ${m[0].trim()}`);
            }
        }
        expect(offenders, "use useConfirm/usePrompt from @/core/sdk/ui instead").toEqual([]);
    });

    it("a date is formatted in the site's locale, not the renderer's", () => {
        const allowed = "src/core/hooks/useLocalDate.ts";
        const offenders: string[] = [];
        for (const file of FILES) {
            if (file === allowed) continue;
            const src = code(file);
            for (const m of src.matchAll(/\.toLocale(?:Date|Time)?String\(\s*\)/g)) {
                offenders.push(`${file}: ${m[0]}`);
            }
        }
        expect(offenders, `pass a locale, or use useLocalDate from @/core/sdk/ui`).toEqual([]);
    });

    it("a failed write does not fall back to an English sentence", () => {
        const offenders: string[] = [];
        // Components only, for the same reason as below: a route builds the
        // response, a component decides what a person reads.
        for (const file of FILES.filter((f) => f.endsWith(".tsx"))) {
            const src = code(file);
            for (const m of src.matchAll(/\.error\s*\|\|\s*(["'])((?:[^"'\\]|\\.)+)\1/g)) {
                offenders.push(`${file}: ${m[2]}`);
            }
            for (const m of src.matchAll(/\bset\w*Error\(\s*(["'])((?:[^"'\\]|\\.)+)\1\s*\)/g)) {
                if (looksLikeProse(m[2])) offenders.push(`${file}: ${m[2]}`);
            }
            for (const m of src.matchAll(/err(?:or)?\.message\s*:\s*(["'])((?:[^"'\\]|\\.)+)\1/g)) {
                if (looksLikeProse(m[2])) offenders.push(`${file}: ${m[2]}`);
            }
        }
        expect(offenders, "give the fallback a translation key").toEqual([]);
    });

    it("a screen does not render the endpoint's own sentence", () => {
        // `data.error || t("saveFailed")` was the whole family: every one of
        // them reads as a translated fallback and is the reverse of one,
        // because `error` is the English the route wrote and it is almost
        // never absent. The check above catches only the ones whose fallback
        // slot held an English literal too; this one catches the shape.
        //
        // Routes are exempt: `error` there is the wire format, and a route
        // has no translator to reach for. `errorMessage` and `writeError`
        // are what a screen uses to turn one into something a reader can be
        // shown - the caller's key, or the `err.<code>` its catalogue knows.
        const offenders: string[] = [];
        for (const file of FILES.filter((f) => !f.includes("/api/"))) {
            const src = code(file);
            for (const m of src.matchAll(/\b\w+\??\.error\s*\|\|/g)) {
                offenders.push(`${file}: ${m[0]}`);
            }
        }
        expect(offenders, "use errorMessage(body, t(\"key\"), t) from @/core/sdk").toEqual([]);
    });

    it("what a control suggests or asks is a translation key", () => {
        const offenders: string[] = [];
        // Components only. The same field names appear in API route bodies,
        // where they are the wire format rather than anything a reader sees -
        // and a client that renders them is the separate defect `writeError`
        // is there to catch.
        for (const file of FILES.filter((f) => f.endsWith(".tsx"))) {
            if (STAYS_IN_ENGLISH[file]) continue;
            const src = code(file);
            for (const m of src.matchAll(READER_FACING)) {
                if (looksLikeProse(m[3])) offenders.push(`${file}: [${m[1]}] ${m[3]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("an expression in a reader-facing attribute is keyed too", () => {
        // The check above reads `aria-label="..."`. A ternary is the shape
        // that got past it: `aria-label={voted ? "Remove vote" : "Upvote"}`
        // is three English sentences the screen reader says out loud, and
        // none of them is a quoted attribute value.
        //
        // `title` is not in this list on purpose - it is also the name of a
        // node prop (`<AdminPageHeader title={<>...</>}>`), whose expression
        // is full of class names rather than anything a reader hears.
        const offenders: string[] = [];
        for (const file of FILES.filter((f) => f.endsWith(".tsx"))) {
            if (STAYS_IN_ENGLISH[file]) continue;
            const src = code(file);
            for (const m of src.matchAll(/\b(aria-label|placeholder|alt)=\{/g)) {
                for (const text of literalsIn(src, m.index + m[0].length)) {
                    if (looksLikeProse(text)) offenders.push(`${file}: [${m[1]}] ${text}`);
                }
            }
        }
        expect(offenders, "give the expression's branches translation keys").toEqual([]);
    });

    it("every allowlisted file exists and carries a reason", () => {
        for (const [file, reason] of Object.entries(STAYS_IN_ENGLISH)) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is gone`).toBe(true);
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
            // An entry that no longer has English in it is dead weight.
            const src = code(file);
            const hits = [...src.matchAll(READER_FACING)].filter((m) => looksLikeProse(m[3]));
            expect(hits.length, `${file} no longer needs the allowlist`).toBeGreaterThan(0);
        }
    });

    it("the SDK carries the replacements a module needs", () => {
        expect(read("src/core/sdk/index.ts")).toContain("errorMessage");
        const sdk = read("src/core/sdk/ui.ts");
        for (const name of ["usePrompt", "useLocalDate", "useRelativeTime", "LoadFailed"]) {
            expect(sdk, `@/core/sdk/ui must export ${name}`).toContain(name);
        }
    });

    it("the confirm dialog labels its own buttons from the catalogue", () => {
        const dialog = read("src/core/components/ui/confirm-dialog.tsx");
        expect(dialog).not.toContain('|| "Cancel"');
        expect(dialog).not.toContain('|| "Confirm"');
        expect(dialog).toContain('t("cancel")');
        expect(dialog).toContain('t("confirm")');
    });

    it("both locales carry every key this round added", () => {
        const en = JSON.parse(read("messages-core/en.json"));
        const tr = JSON.parse(read("messages-core/tr.json"));
        const wanted: [string, string][] = [
            ["common", "confirm"],
            ["common", "cancel"],
            ["common", "preview"],
            ["common", "somethingWentWrong"],
            ["admin", "ipBlocks_ipHint"],
            ["admin", "sidebar_adminHome"],
            ["admin", "users_reasonPlaceholder"],
            ["admin", "footer_aboutTextPlaceholder"],
            ["admin", "footer_copyrightPlaceholder"],
        ];
        for (const [ns, key] of wanted) {
            expect(en[ns]?.[key], `en.${ns}.${key}`).toBeTruthy();
            expect(tr[ns]?.[key], `tr.${ns}.${key}`).toBeTruthy();
        }
    });
});
