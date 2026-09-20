import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A list that grows carries a way through it.
 *
 * Measured across the panel on 2026-09-19: 156 admin screens, 67 of them
 * showing a list, three with a box to search it and one with any way to pick
 * rows. Every one of those lists grows with use - members, orders, gift codes,
 * webhook deliveries, punishments - and the only way to a row that was not on
 * the first page was to page until it appeared.
 *
 * The rule is read off the source because the failure is quiet: a screen with
 * no search looks finished, and only becomes a problem on an installation
 * with enough rows to need one, which is never the installation the author
 * was looking at.
 *
 * What counts as a way through: the crud shell, which draws the strip for the
 * screens built on it; the shared strip itself; or a term sent to the
 * endpoint. What does not count is a screen that fetches a page and then
 * sieves it in the browser - that answers over the rows that happened to
 * arrive, which is how the orders screen told an operator a refund had never
 * happened.
 *
 * `BOUNDED` is where the judgement lives. A list an operator sets the size of
 * - the roles they invented, the categories they curated, the cron jobs the
 * app declares - does not grow with use and a box above it is furniture.
 * Every line is a decision, and the list should shrink rather than grow.
 */

const ROOT = process.cwd();

/**
 * Screens whose list does not grow with use. Each line says why.
 */
const BOUNDED: Record<string, string> = {
    "src/app/[locale]/(admin)/admin/cron/page.tsx":
        "The jobs the app and its modules declare. The list is as long as the code, not as long as the site has been running.",
    "src/app/[locale]/(admin)/admin/modules/page.tsx":
        "The modules installed and the ones offered. It has its own filters by category and tag, and a redesign of this screen is its own item.",
    "src/app/[locale]/(admin)/admin/theme/appearance/page.tsx":
        "The settings one theme declares. An operator cannot add to it.",
    "src/app/[locale]/(admin)/admin/settings/footer/page.tsx":
        "The footer an operator built, plus what the installed modules put in it. Both are as long as the site was configured to be, and a footer is read whole rather than looked one thing up in.",
    "module-sources/login-protection/pages/admin/page.tsx":
        "The accounts locked out at this moment, which on a site that is not under attack is none and under one is a handful the operator reads whole. It is capped at 200 and every row leaves it within the hour.",
    "src/app/[locale]/(admin)/admin/updates/page.tsx":
        "The releases behind the version installed, which is a handful.",
    "src/app/[locale]/(admin)/admin/observability/page.tsx":
        "A dashboard of counters, not a list of rows.",
    "src/app/[locale]/(admin)/admin/audit-log/page.tsx":
        "It narrows by action, by member and by date, and sends all three to the endpoint. A free-text box over the same rows would answer a question the three already answer better.",
    "module-sources/blog/pages/admin/categories/page.tsx":
        "Categories are hand-curated and an operator can hold the whole list in their head.",
    "module-sources/forum/pages/admin/categories/page.tsx":
        "The same, and the order they are in is the thing being edited.",
    "module-sources/store/pages/admin/categories/page.tsx":
        "The same, and this one is a tree: a child row only means anything underneath its parent, so narrowing to a row would hide what it belongs to.",
    "module-sources/custom-forms/pages/admin/page.tsx":
        "The forms an operator built. Their submissions grow; the forms do not.",
    "module-sources/discord-integration/pages/admin/messages/page.tsx":
        "One row per event the modules declare, which is as long as the code.",
    "module-sources/currency/pages/admin/page.tsx":
        "The currencies an operator turned on, plus the rate beside each. An operator cannot have more of them than they chose to enable.",
    "module-sources/referral/pages/admin/page.tsx":
        "Settings and a scoreboard, not a list to look somebody up in.",
    "module-sources/minecraft-litebans/pages/admin/page.tsx":
        "One connection and what probing it reported.",
    "src/app/[locale]/(admin)/admin/analytics/page.tsx":
        "Charts and counters. The repeated block is a row of a chart's legend, not a row somebody looks one thing up in.",
    "src/app/[locale]/(admin)/admin/page.tsx":
        "The dashboard. What it repeats is the widgets an operator arranged, and they are as many as they chose to place.",
    "src/app/[locale]/(admin)/admin/system/page.tsx":
        "Facts about the machine and the build, in a fixed set of rows.",
    "src/app/[locale]/(admin)/admin/settings/general/page.tsx":
        "A settings form. What it repeats is the fields of one record.",
    "src/app/[locale]/(admin)/admin/settings/rate-limits/page.tsx":
        "One row per limit the app declares, which is as long as the code.",
    "src/app/[locale]/(admin)/admin/settings/theme/page.tsx":
        "The themes installed, which an operator installs one at a time.",
    "src/app/[locale]/(admin)/admin/modules/updates/page.tsx":
        "The updates waiting, which is at most one per installed module and usually none.",
    "module-sources/forum/pages/admin/permissions/page.tsx":
        "A grid of the categories an operator made against the roles they made. Both are hand-curated, and narrowing one axis would hide what the other is set to.",
    "module-sources/discord-integration/pages/admin/page.tsx":
        "The webhooks an operator wired up, one per destination they chose.",
    "module-sources/custom-forms/pages/admin/submissions/page.tsx":
        "Submissions do grow, and this screen is being redesigned as its own item; the search lands with that redesign rather than on top of the layout it is replacing.",
};

/** A screen offers a way through when one of these is true. */
function hasAWayThrough(source: string): boolean {
    if (source.includes("AdminCrudPage")) return true;
    if (source.includes("<ListControls")) return true;
    // A term the screen sends to whoever holds the rows.
    return /\bq:|["'`]q["'`]\s*,|set\("q"|set\("search"|search=\$\{/.test(source);
}

/**
 * A screen draws a list when it maps rows into repeated markup that carries a
 * key.
 *
 * `grid` and `space-y-4` were the first attempt and they match the layout of
 * every settings form on the site, so the rule reported thirty screens with
 * no list on them at all. A `key` is the honest signal: React only asks for
 * one where a row is one of many.
 */
function drawsAList(source: string): boolean {
    for (const match of source.matchAll(/\.map\(\(?\s*\(?\w/g)) {
        const body = source.slice(match.index ?? 0, (match.index ?? 0) + 400);
        if (!/key=\{/.test(body)) continue;
        if (/<tr\b|<li\b|<Card\b|divide-y/.test(body)) return true;
    }
    return false;
}

function adminScreens(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
            } else if (entry.name === "page.tsx") {
                found.push(path.relative(ROOT, full));
            }
        }
    };
    walk(path.join(ROOT, "src/app/[locale]/(admin)/admin"));
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        walk(path.join(ROOT, "module-sources", id, "pages/admin"));
    }
    return found.sort();
}

/**
 * The screen's own code plus the component it hands the list to.
 *
 * A screen that keeps its table in a component of its own is not a screen
 * without a search; the SEO editor is exactly that shape.
 */
function screenAndItsList(rel: string): string {
    const file = path.join(ROOT, rel);
    let source = stripComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const base = path.resolve(path.dirname(file), match[1]);
        for (const candidate of [`${base}.tsx`, path.join(base, "index.tsx")]) {
            if (fs.existsSync(candidate)) source += stripComments(fs.readFileSync(candidate, "utf8"));
        }
    }
    return source;
}

describe("an admin list", () => {
    const screens = adminScreens();

    it("finds the screens, so a broken scan cannot pass quietly", () => {
        expect(screens.length).toBeGreaterThan(120);
    });

    it("can be searched wherever it grows with use", () => {
        const stuck = screens
            .filter((rel) => !(rel in BOUNDED))
            // A screen for one row is a form, not a list: it can hold a
            // repeated block - a product's commands, a ticket's replies - and
            // there is nothing to search.
            .filter((rel) => !/\[[^\]]+\]\/page\.tsx$|\/new\/page\.tsx$|\/edit\/page\.tsx$/.test(rel))
            .filter((rel) => {
                const source = screenAndItsList(rel);
                return drawsAList(source) && !hasAWayThrough(source);
            });
        expect(stuck).toEqual([]);
    });

    it("keeps every exemption to a screen that exists, with a reason", () => {
        for (const [rel, reason] of Object.entries(BOUNDED)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
            expect(reason.length, rel).toBeGreaterThan(40);
        }
    });
});
