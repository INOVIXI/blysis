// @vitest-environment node
/**
 * The screen that hid a row can still see it.
 *
 * An endpoint a visitor reads filters: `where: { isActive: true }`. When the
 * screen that manages those rows reads the same answer, the switch labelled
 * "Active" removes the row from the only screen that could switch it back on.
 * The operator's next move is the database.
 *
 * Found first in the help centre, where `/help/articles` and
 * `/help/categories` answered the published list and the panel was their only
 * caller: an article somebody deactivated left the screen that could bring it
 * back. Then again in popups, where the endpoint answers "is there something
 * to show right now?" with `take: 1`, so the panel listed one row of three.
 * Then again in game servers. Three times is a rule, so this is the census.
 *
 * A screen passes by asking for the operator's answer - `scope=admin`, or
 * `listPath` pointing at it - or by being a picker rather than a manager, and
 * saying so below. The endpoint may also answer everything to an operator
 * without being asked, which is what the slider does.
 *
 * ## A picker is a different question
 *
 * Offering only the shelves a shopper can see is a defensible default for a
 * box that chooses one. It stops being defensible when the row already chosen
 * is one of the hidden ones: the box cannot show what is selected, and a save
 * writes back whatever it is showing. That is a sharper bug than this gate
 * measures and it is written down rather than fixed here.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Screens that read the visitor's answer on purpose, with the reason.
 *
 * Every one of these is a box that picks one row, not a screen that manages
 * them. See the note above for the case that is not yet answered.
 */
const PICKS_RATHER_THAN_MANAGES: Record<string, string> = {
    "module-sources/changelog/pages/admin/page.tsx":
        "Picks the kind of release an entry is. A kind the operator retired is not one to file a new entry under.",
    "module-sources/custom-forms/pages/admin/submissions/page.tsx":
        "Narrows submissions by the form they came through. The forms on offer are the ones still taking answers.",
    "module-sources/help-center/pages/admin/help/CategoryForm.tsx":
        "Picks the section an article belongs in. A hidden section is not one to file a new article under.",
    "module-sources/store/pages/admin/bulk-discounts/page.tsx":
        "Picks the shelf a discount applies to, from the shelves a shopper can reach.",
    "module-sources/store/pages/admin/coupons/page.tsx":
        "Picks the shelf a coupon is scoped to, from the shelves a shopper can reach.",
    "module-sources/store/pages/admin/creator-codes/page.tsx":
        "Picks the shelf a creator's code may be used on, from the shelves a shopper can reach.",
    "module-sources/store/pages/admin/products/new/page.tsx":
        "Picks the shelf a new product goes on, from the shelves a shopper can reach.",
    "module-sources/store/pages/admin/products/[id]/edit/page.tsx":
        "Picks the shelf a product being edited sits on, from the shelves a shopper can reach.",
};

function walk(dir: string, name: RegExp, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, name, out);
        else if (name.test(entry.name)) out.push(full);
    }
    return out;
}

/** Every module API path, and the handler that serves it. */
function moduleHandlers(): Map<string, string> {
    const handlers = new Map<string, string>();
    for (const manifest of walk(path.join(ROOT, "module-sources"), /^module\.json$/)) {
        let json: { api?: { path: string; handler: string }[] };
        try {
            json = JSON.parse(fs.readFileSync(manifest, "utf8"));
        } catch {
            continue;
        }
        for (const entry of json.api ?? []) {
            handlers.set(`/api/v1${entry.path}`, path.join(path.dirname(manifest), entry.handler));
        }
    }
    return handlers;
}

const adminScreens = [
    ...walk(path.join(ROOT, "module-sources"), /\.tsx$/).filter(
        (file) => file.includes(`${path.sep}pages${path.sep}admin${path.sep}`),
    ),
    ...walk(path.join(ROOT, "src/app/[locale]/(admin)"), /\.tsx$/),
];

/** `where: { ... isActive: true ... }`: a filter, not a select or a default. */
const HIDES = /where:\s*\{[^}]{0,200}?(isActive|isPublished|isVisible):\s*true/;

/**
 * Only what the GET answers.
 *
 * The first version read the whole file and named `url-redirects`, whose GET
 * hands over every rule - the `isActive` filter it matched is in the POST,
 * which reads the live rules to check a new one does not make a loop. A
 * filter in a write is not a filter on what the screen is shown.
 */
function readHandler(endpoint: string): string {
    const start = endpoint.search(/export\s+(?:async\s+)?(?:function|const)\s+GET\b/);
    if (start === -1) return "";
    const after = endpoint.slice(start + 10);
    const next = after.search(/export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b/);
    return next === -1 ? after : after.slice(0, next);
}
/** Asking for the operator's answer, either way round. */
const ASKS = /scope=admin|listPath/;
/** Or the endpoint answers everything to an operator without being asked. */
const ANSWERS_ADMIN = /admin\s*\?\s*\{\s*\}/;

describe("an admin screen that reads a module endpoint", () => {
    const handlers = moduleHandlers();

    it("finds the screens and the endpoints, so a broken scan cannot pass quietly", () => {
        expect(adminScreens.length).toBeGreaterThan(100);
        expect(handlers.size).toBeGreaterThan(100);
    });

    it("sees the rows it switched off, or says it is only picking one", () => {
        const blind: string[] = [];
        for (const screen of adminScreens) {
            const rel = path.relative(ROOT, screen);
            if (rel in PICKS_RATHER_THAN_MANAGES) continue;
            const source = fs.readFileSync(screen, "utf8");
            if (ASKS.test(source)) continue;

            for (const match of source.matchAll(/["'`](\/api\/v1\/[A-Za-z0-9/_\-[\].${}]+)["'`]/g)) {
                const url = match[1].split("?")[0].replace(/\$\{[^}]*\}/g, "[id]");
                const handler = handlers.get(url);
                if (!handler || !fs.existsSync(handler)) continue;
                const endpoint = fs.readFileSync(handler, "utf8");
                const read = readHandler(endpoint);
                if (!HIDES.test(read)) continue;
                if (ASKS.test(read) || ANSWERS_ADMIN.test(read)) continue;
                blind.push(`${rel}\n    reads ${url}`);
            }
        }
        expect(
            [...new Set(blind)],
            "These read an answer with the hidden rows filtered out, so the switch\n" +
            "that hid a row removed it from the screen that could bring it back.\n" +
            "Ask for the operator's answer, or name the screen in\n" +
            `PICKS_RATHER_THAN_MANAGES with the reason it only picks one:\n${[...new Set(blind)].join("\n")}`,
        ).toEqual([]);
    });

    it("keeps every exemption to a screen that exists, with a reason", () => {
        for (const [rel, reason] of Object.entries(PICKS_RATHER_THAN_MANAGES)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
            expect(reason.length, rel).toBeGreaterThan(40);
        }
    });
});
