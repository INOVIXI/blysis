/**
 * Every control that moves a reader between pages comes from one component.
 *
 * `Pagination` has existed since the admin lists got pagers, and twenty-eight
 * screens use it. Eleven did not: measured on 2026-09-11, the blog index drew
 * two bare text links with "2 / 7" between them, the homepage news section
 * drew chevrons with labels and every page number, the forum drew outline
 * buttons with no numbers at all, three admin lists drew icon-only chevrons,
 * and the punishments list drew the raw characters « and » with no
 * translation behind them.
 *
 * Six looks for one act. A reader who learns where "next" is on the blog
 * finds something else in the forum, and each hand-written pager carried its
 * own bug: the blog admin's hrefs were built as `?page=N`, which dropped
 * whatever filter the admin had typed.
 *
 * The rule is about the control, not the act of paging. A carousel, an image
 * gallery and a setup wizard all move between things; none of them is a pager,
 * and none of them mentions a page count.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

const ROOT = process.cwd();

/** Files allowed to draw paging controls without the shared component. */
const ALLOWED: Record<string, string> = {
    "src/core/components/ui/pagination.tsx":
        "The component itself, which is the one place the control is allowed to be drawn by hand.",
    "src/core/components/ui/icon-picker.tsx":
        "A picker popover that reveals more icons into the same scroll box. There are no pages to be on, so there is no page to name.",
    "module-sources/license-keys/components/ProfileLicensesTab.tsx":
        "A cursor-fed list: the endpoint hands back an opaque cursor, not a page count, so there is no page number to draw.",
};

/** What a file says when it is drawing a pager. */
const PAGER_SIGNALS = [
    /\btotalPages\b/,
    /\bcurrentPage\b/,
    /\bpageOf\b/,
    /\badm_pageOf\b/,
    /\bpaginationPageOf\b/,
    // The tell every hand-written pager shares, whatever it calls its state.
    /\bpage\s*[-+]\s*1\b/,
];

/** What a file says when it is drawing the control rather than counting. */
const CONTROL_SIGNALS = [
    /ChevronLeft/,
    /ChevronRight/,
    /adm_previous/,
    /adm_next/,
    /\bT?\w*\(\s*["'](previous|next|previousPage|nextPage)["']/,
    /&laquo;|&raquo;|[«»]/,
];

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                // `src/modules` is the installed copy of `module-sources`, rewritten
                // by the installer. Reporting both would name every offence twice.
                if (entry.name === "node_modules" || entry.name === "generated" || relativePath(ROOT, full) === "src/modules") continue;
                walk(full);
            } else if (/\.tsx?$/.test(entry.name)) {
                out.push(relativePath(ROOT, full));
            }
        }
    };
    walk(path.join(ROOT, dir));
    return out;
}

/** True when the file gets its pager from the shared component. */
function usesSharedPagination(src: string): boolean {
    // The identifier has to arrive through an import. Matching the bare word
    // passed every file that had written `{/* Pagination */}` above its own.
    return /import\s*\{[^}]*\bPagination\b[^}]*\}\s*from\s*["']@\/core\/(sdk\/ui|components\/ui)/.test(src);
}

describe("a control that moves between pages", () => {
    it("is drawn by the shared component wherever it appears", () => {
        const offenders: string[] = [];

        for (const file of [...sourceFiles("src"), ...sourceFiles("module-sources")]) {
            if (file in ALLOWED) continue;
            const src = fs.readFileSync(path.join(ROOT, file), "utf8");
            const draws = PAGER_SIGNALS.some((r) => r.test(src)) && CONTROL_SIGNALS.some((r) => r.test(src));
            if (draws && !usesSharedPagination(src)) offenders.push(file);
        }

        expect(offenders).toEqual([]);
    });

    it("names a reason for every file excused from the rule", () => {
        for (const [file, reason] of Object.entries(ALLOWED)) {
            expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
            expect(reason.length).toBeGreaterThan(40);
        }
    });
});
