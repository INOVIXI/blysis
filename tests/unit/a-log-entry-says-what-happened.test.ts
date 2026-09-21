// @vitest-environment node
/**
 * An entry in the audit log says what happened, in the reader's language.
 *
 * `logActivity` files a row under a machine name and the screen printed that
 * name straight out: `data_exported`, `ticket_status.update`,
 * `admin.user.data_exported`. The column is honestly headed "Action key" and
 * the filter beside it takes one, so the key belongs on that screen - but a
 * key is how the code refers to a thing, and an operator scrolling eighty of
 * them is reading code to find out who deleted what.
 *
 * So the screen draws both, and this holds the half that can rot: every
 * action anything files has a name, and the name exists in both languages.
 *
 * Core names its own. A module names its own, in its manifest, because 44
 * of the 84 are a module's and core must not know a module
 * exists - the same seam `activityTitles` already uses for the activity feed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Actions built from a variable, and what they can come out as.
 *
 * Four call sites interpolate. A scanner cannot resolve them, and guessing
 * would let a new one through unnoticed, so each is written down beside the
 * values its own code can produce. A fifth template appearing in the tree
 * fails this test until somebody rules on it.
 */
const TEMPLATES: Record<string, string[]> = {
    'license.${data.status === "revoked" ? "revoked" : "restored"}': ["license.revoked", "license.restored"],
    "moderation.${action}": ["moderation.approve", "moderation.reject"],
    "ticket_${kind}.create": ["ticket_status.create", "ticket_priority.create"],
    "ticket_${kind}.update": ["ticket_status.update", "ticket_priority.update"],
    "ticket_${kind}.delete": ["ticket_status.delete", "ticket_priority.delete"],
};

/** Every action string handed to `logActivity`, read from the call sites. */
function loggedActions(): { action: string; where: string }[] {
    const out: { action: string; where: string }[] = [];

    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.(ts|tsx)$/.test(entry.name)) continue;

            const source = fs.readFileSync(full, "utf8");
            for (const call of source.matchAll(/logActivity\s*\(\s*\{/g)) {
                // Walk the object rather than regex to its first `}`: these
                // carry nested `metadata` objects and a ternary or two.
                let depth = 1;
                let i = call.index + call[0].length;
                while (i < source.length && depth > 0) {
                    if (source[i] === "{") depth += 1;
                    else if (source[i] === "}") depth -= 1;
                    i += 1;
                }
                const body = source.slice(call.index, i);
                // Each quote read to its own closer: a template literal here
                // holds a ternary with quoted branches inside it, and one
                // character class for all three stopped at the first of them.
                const named = /\baction:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/.exec(body);
                const action = named?.[1] ?? named?.[2] ?? named?.[3];
                if (action) out.push({ action, where: path.relative(ROOT, full) });
            }
        }
    };

    for (const dir of ["src/app", "src/core", "module-sources"]) walk(path.join(ROOT, dir));
    return out;
}

/** What core names, read as text so this runs without the generated registry. */
function coreNames(): Record<string, string> {
    const source = fs.readFileSync(path.join(ROOT, "src/core/lib/audit-action.ts"), "utf8");
    const block = source.slice(source.indexOf("const CORE_AUDIT_NAMES"), source.indexOf("const NAMES"));
    return Object.fromEntries([...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

/** What the modules name, read from the manifests rather than the registry. */
function moduleNames(): Record<string, { nameKey: string; module: string }> {
    const out: Record<string, { nameKey: string; module: string }> = {};
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        const manifest = path.join(ROOT, "module-sources", id, "module.json");
        if (!fs.existsSync(manifest)) continue;
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
        for (const entry of parsed.auditActions ?? []) {
            out[entry.action] = { nameKey: entry.nameKey, module: id };
        }
    }
    return out;
}

function saysIt(locale: "en" | "tr", nameKey: string, module: string | null): boolean {
    if (module) {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(ROOT, "module-sources", module, "module.json"), "utf8"),
        );
        return typeof manifest.translations?.[locale]?.activity?.[nameKey] === "string";
    }
    const core = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
    return typeof core.activity?.[nameKey] === "string";
}

describe("every action the audit log files", () => {
    const logged = loggedActions();
    const core = coreNames();
    const modules = moduleNames();

    /** Templates resolved, so a name is checked against what is actually filed. */
    const resolved = logged.flatMap(({ action, where }) =>
        (TEMPLATES[action] ?? [action]).map((one) => ({ action: one, where, template: action in TEMPLATES })),
    );

    it("is found, all of it", () => {
        // A scanner that walks the wrong tree passes by finding nothing.
        expect(logged.length).toBeGreaterThan(70);
        expect(logged.some((entry) => entry.where.startsWith("module-sources/"))).toBe(true);
    });

    it("is built from a literal, or is a template that says what it becomes", () => {
        const unruled = logged
            .filter(({ action }) => action.includes("${") && !(action in TEMPLATES))
            .map(({ action, where }) => `${where}: ${action}`);
        expect(
            unruled,
            "an action built from a variable cannot be read from here. Add it to TEMPLATES " +
            "above with the values its own code can produce",
        ).toEqual([]);
    });

    it("has a name", () => {
        const nameless = resolved
            .filter(({ action }) => !core[action] && !modules[action])
            .map(({ action, where }) => `${where}: ${action}`);
        expect(
            [...new Set(nameless)],
            "an operator reads this list to find out who did what. Name it in " +
            "CORE_AUDIT_NAMES, or in the module's own `auditActions` if the module files it",
        ).toEqual([]);
    });

    it("says it in both languages", () => {
        const silent: string[] = [];
        for (const { action } of resolved) {
            const owner = modules[action];
            const nameKey = owner?.nameKey ?? core[action];
            if (!nameKey) continue;
            for (const locale of ["en", "tr"] as const) {
                if (!saysIt(locale, nameKey, owner?.module ?? null)) {
                    silent.push(`${locale}: ${nameKey} (${action})`);
                }
            }
        }
        expect([...new Set(silent)]).toEqual([]);
    });

    it("names it as prose, because an audit line is a sentence about somebody", () => {
        // "Deleted a role", not "Role Delete". A name that titles itself
        // reads as a menu entry rather than as something that happened.
        const shouting: string[] = [];
        const core_en = JSON.parse(fs.readFileSync(path.join(ROOT, "messages-core/en.json"), "utf8"));
        for (const [, nameKey] of Object.entries(core)) {
            const value = core_en.activity?.[nameKey];
            if (typeof value !== "string") continue;
            const words = value.split(" ").slice(1);
            if (words.some((word) => /^[A-Z][a-z]/.test(word))) shouting.push(`${nameKey}: ${value}`);
        }
        expect(shouting).toEqual([]);
    });
});
