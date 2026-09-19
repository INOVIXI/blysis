import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A screen that can delete one row can delete several.
 *
 * Measured across the panel on 2026-09-19: 67 admin screens showing a list
 * and one of them offered any way to pick rows. On the rest, clearing out
 * forty expired gift codes was forty confirmations - so nobody did it, and
 * the table grew until the screen was useless for the one thing it exists
 * for.
 *
 * The rule is narrow on purpose. Not every list wants a bulk action: an audit
 * log has nothing to delete and a settings screen has no rows. What does want
 * one is a screen that already offers to delete a row, because the operator
 * who wants to delete one usually wants to delete the four beside it.
 *
 * `BulkBar` is the answer, and `AdminCrudPage` draws it for the screens built
 * on it. `deleteEach` is how the several requests report themselves, and its
 * own test holds the arithmetic.
 */

const ROOT = process.cwd();

/**
 * Screens that delete one row and should not offer to delete several. Each
 * line is a decision.
 */
const ONE_AT_A_TIME: Record<string, string> = {
    "src/app/[locale]/(admin)/admin/users/[id]/page.tsx":
        "Deleting a member is one deliberate act with its own confirmation and a typed name; there is no list of members here to tick.",
    "src/app/[locale]/(admin)/admin/roles/[id]/edit/page.tsx":
        "One role, on its own edit screen. The list that could offer several is the roles screen, and a role is not something an operator has forty of.",
    "src/app/[locale]/(admin)/admin/backup/page.tsx":
        "Restoring and deleting a backup are different weights of decision, and the row carries both. Ticking four and pressing delete is the wrong shape for the one action nobody should take quickly.",
    "module-sources/store/pages/admin/products/[id]/edit/page.tsx":
        "One product, on its own edit screen, where deleting is the end of editing rather than a list operation.",
    "module-sources/custom-pages/pages/admin/builder/[id]/page.tsx":
        "The page builder is a full-screen editor for one page, with its own canvas and toolbar. There is no list of pages in it to tick.",
    "module-sources/help-center/pages/admin/help/page.tsx":
        "It has no delete for an article at all, and no edit either. Giving it a bulk delete before it can delete one row would be half an answer; that is its own item.",
};

/**
 * Screens that should offer it and do not yet. Unlike the list above, these
 * are not decisions - they are work outstanding, and the list is here so it
 * is visible and shrinking rather than forgotten.
 */
const NOT_YET: Record<string, string> = {
    "src/app/[locale]/(admin)/admin/api-keys/page.tsx": "",
    "src/app/[locale]/(admin)/admin/broadcasts/page.tsx": "",
    "src/app/[locale]/(admin)/admin/email-queue/page.tsx": "",
    "src/app/[locale]/(admin)/admin/roles/page.tsx": "",
    "src/app/[locale]/(admin)/admin/warnings/page.tsx": "",
    "src/app/[locale]/(admin)/admin/settings/theme/page.tsx": "",
    "module-sources/blog/pages/admin/articles/[id]/edit/page.tsx": "",
    "module-sources/blog/pages/admin/categories/page.tsx": "",
    "module-sources/comparison-table/pages/admin/page.tsx": "",
    "module-sources/custom-forms/pages/admin/page.tsx": "",
    "module-sources/forum/pages/admin/topics/page.tsx": "",
    "module-sources/license-keys/pages/admin/licenses/page.tsx": "",
    "module-sources/seo/pages/admin/pages/page.tsx": "",
    "module-sources/store/pages/admin/campaigns/page.tsx": "",
    "module-sources/store/pages/admin/categories/page.tsx": "",
};

/** A screen asks to delete a row when it sends DELETE from a row's control. */
function deletesARow(source: string): boolean {
    return /method:\s*["']DELETE["']/.test(source);
}

/** It offers several when it draws the strip, or is drawn by the shell. */
function deletesSeveral(source: string): boolean {
    return /<BulkBar\b/.test(source) || source.includes("AdminCrudPage");
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

describe("deleting rows", () => {
    const screens = adminScreens();

    it("finds the screens, so a broken scan cannot pass quietly", () => {
        expect(screens.length).toBeGreaterThan(120);
    });

    it("is offered in bulk wherever it is offered at all", () => {
        const oneOnly = screens
            .filter((rel) => !(rel in ONE_AT_A_TIME) && !(rel in NOT_YET))
            .filter((rel) => {
                const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
                return deletesARow(source) && !deletesSeveral(source);
            });
        expect(oneOnly).toEqual([]);
    });

    it("keeps the outstanding list to screens that exist, and shrinking", () => {
        for (const rel of Object.keys(NOT_YET)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
        }
        // The number this was written with. It may fall; a rise means a new
        // screen learned to delete a row and not several.
        expect(Object.keys(NOT_YET).length).toBeLessThanOrEqual(15);
    });

    it("keeps every exemption to a screen that exists, with a reason", () => {
        for (const [rel, reason] of Object.entries(ONE_AT_A_TIME)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
            expect(reason.length, rel).toBeGreaterThan(60);
        }
    });
});
