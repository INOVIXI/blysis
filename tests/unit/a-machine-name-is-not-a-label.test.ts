import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Nothing a member reads is a name only a machine uses.
 *
 * The filter above a member's own activity listed the kinds that account has,
 * and it listed them by the `type` column: `vote.vote.cast`, `wheel.prize.won`.
 * The notification grid printed `credits.credit.added` under every label. Both
 * were built the same way - the identifier was to hand, so it was rendered -
 * and both were on the screens a member reads about themselves.
 *
 * A hook name, an enum member, an event type, a settings key and a slug are
 * how the code refers to a thing. What a person reads is a translated string.
 * When one of those has no string yet, that is the bug; falling back to the
 * identifier only hides it until somebody opens the page.
 *
 * Two rules here, and a third in
 * `a-notification-toggle-does-something.test.ts`, which came first.
 */

const ROOT = process.cwd();
const MODULES = path.join(ROOT, "module-sources");

interface Manifest {
    activityTitles?: { type: string; nameKey: string; prefix?: string; key?: string }[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

function manifests(): Map<string, Manifest> {
    const out = new Map<string, Manifest>();
    for (const id of fs.readdirSync(MODULES)) {
        const file = path.join(MODULES, id, "module.json");
        if (fs.existsSync(file)) out.set(id, JSON.parse(fs.readFileSync(file, "utf8")) as Manifest);
    }
    return out;
}

/** Every activity type anything writes to the feed. */
function writtenTypes(): { type: string; where: string }[] {
    const found: { type: string; where: string }[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            for (const call of source.matchAll(/activityFeedItem\.create\(/g)) {
                const chunk = source.slice(call.index ?? 0, (call.index ?? 0) + 800);
                const type = /type:\s*"([^"]+)"/.exec(chunk);
                if (type) found.push({ type: type[1], where: path.relative(ROOT, full) });
            }
        }
    };
    walk(path.join(ROOT, "src/core"));
    walk(path.join(ROOT, "src/app"));
    walk(MODULES);
    return found;
}

/** The names core declares for its own events, read off the source. */
function coreNames(): Map<string, string> {
    const source = fs.readFileSync(path.join(ROOT, "src/core/lib/activity-title.ts"), "utf8");
    const block = source.slice(source.indexOf("const CORE_NAMES"), source.indexOf("const NAMES"));
    const out = new Map<string, string>();
    for (const m of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) out.set(m[1], m[2]);
    return out;
}

function coreMessages(locale: string): Record<string, Record<string, string>> {
    return JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
}

/**
 * A string that is an identifier rather than a sentence: `store.order.created`,
 * `credit_purchase`, `MAX_UPLOAD`. Anything with a space in it is prose, and a
 * single lower-case word is a word.
 */
const LOOKS_LIKE_AN_IDENTIFIER = /^(?:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)$/;

/**
 * Strings that are shaped like an identifier and are not one.
 *
 * An address has dots in it for the same reason an event type does, and
 * nothing in the shape tells them apart. Each entry is here on purpose, with
 * the reason it is not a leaked identifier.
 */
const NOT_IDENTIFIERS = new Set([
    // A server address, shown in the box where an operator types theirs.
    "play.example.com",
]);

describe("a machine name is not a label", () => {
    const declared = manifests();
    const core = coreNames();

    it("finds the events and the declarations", () => {
        expect(writtenTypes().length).toBeGreaterThan(15);
        expect(core.size).toBeGreaterThan(0);
    });

    it("names every kind of activity anything writes", () => {
        const named = new Set(core.keys());
        for (const manifest of declared.values()) {
            for (const entry of manifest.activityTitles ?? []) named.add(entry.type);
        }
        const unnamed = writtenTypes()
            .filter(({ type }) => !named.has(type))
            .map(({ type, where }) => `${type} (${where})`);
        expect(unnamed, "written to the feed with no name, so a filter shows the type").toEqual([]);
    });

    it("says every kind in both languages", () => {
        const missing: string[] = [];
        for (const locale of ["en", "tr"]) {
            const messages = coreMessages(locale);
            for (const key of core.values()) {
                if (!messages?.activity?.[key]) missing.push(`core: ${locale}.activity.${key}`);
            }
            for (const [id, manifest] of declared) {
                for (const entry of manifest.activityTitles ?? []) {
                    if (!manifest.translations?.[locale]?.activity?.[entry.nameKey]) {
                        missing.push(`${id}: ${locale}.activity.${entry.nameKey}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("ships no message whose text is an identifier", () => {
        // A catalogue entry whose value is `store.order.created` is somebody
        // writing the key into the file to make a gate pass. It renders as a
        // machine name to a reader either way.
        const offenders: string[] = [];
        const check = (where: string, catalogue: Record<string, Record<string, string>>) => {
            for (const [namespace, entries] of Object.entries(catalogue)) {
                if (typeof entries !== "object" || entries === null) continue;
                for (const [key, value] of Object.entries(entries)) {
                    if (typeof value !== "string") continue;
                    if (NOT_IDENTIFIERS.has(value.trim())) continue;
                    if (LOOKS_LIKE_AN_IDENTIFIER.test(value.trim())) {
                        offenders.push(`${where}: ${namespace}.${key} = ${value}`);
                    }
                }
            }
        };
        for (const locale of ["en", "tr"]) {
            check(`core ${locale}`, coreMessages(locale));
            for (const [id, manifest] of declared) {
                for (const [ns, entries] of Object.entries(manifest.translations?.[locale] ?? {})) {
                    check(`${id} ${locale}`, { [ns]: entries });
                }
            }
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });

    it("fills a {module} placeholder with a name, not an id", () => {
        /*
         * The widget settings screen told an operator that a widget came
         * "from the store module", and "store" is the directory it lives in.
         * The name a reader knows is `admin.module_<id>_name`, which every
         * installed module ships and `moduleName` resolves - and the screen
         * had that id to hand, so it rendered it.
         *
         * A message asking for `{module}` is asking what the module is
         * called. Whatever fills it goes through the helper.
         */
        const offenders: string[] = [];
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === "generated" || entry.name === "modules") continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (!/\.tsx?$/.test(entry.name)) continue;
                const source = stripComments(fs.readFileSync(full, "utf8"));
                // A message call, not a Prisma filter or a type literal:
                // `t("key", { module: ... })` in any of its bindings.
                for (const hit of source.matchAll(/\b\w*[tT]\(\s*"[^"]+"\s*,\s*\{[^{}]*?\bmodule:\s*([^,}]+)/g)) {
                    const filler = hit[1].trim();
                    if (filler.startsWith("moduleName(")) continue;
                    offenders.push(`${path.relative(ROOT, full)}: { module: ${filler} }`);
                }
            }
        };
        walk(path.join(ROOT, "src"));
        expect(offenders, "say what the module is called, not where it lives").toEqual([]);
    });

    it("draws the activity filter through the name, not the column", () => {
        const source = fs.readFileSync(
            path.join(ROOT, "src/core/components/profile/ActivityTab.tsx"),
            "utf8",
        );
        expect(source).toContain("activityTypeLabel(");
        // `facet.type` is the value the option carries; the label beside it
        // has to come from somewhere else.
        expect(/label:\s*`?\$?\{?\s*facet\.type/.test(source), "the option is labelled by its id").toBe(false);
    });
});
