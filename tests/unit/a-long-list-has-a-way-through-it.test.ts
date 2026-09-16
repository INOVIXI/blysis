import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pageWindow } from "@/core/lib/page-window";

/**
 * Paging was written nine times and missing nine more.
 *
 * Nine admin screens each carried the same two ghost buttons with a chevron,
 * a `disabled={page === 1}`, and a "Page 2 / 9" caption - and nothing else.
 * With only a previous and a next, reaching page forty of an audit log takes
 * thirty-nine clicks. Nine other lists that grow without bound - roles, API
 * keys, IP blocks, broadcasts - fetched every row and rendered every row.
 *
 * One component now: numbered pages, first and last, and a box to type a page
 * number into once there are more pages than fit. This gate keeps a tenth copy
 * from being written.
 */

const COMPONENT = "src/core/components/ui/pagination.tsx";

/**
 * Empty on purpose. A screen that steps through something which is not a list
 * of rows - the install wizard, say - would belong here with its reason; none
 * does today.
 */
const ALLOWLIST: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
}

const files = walk("src/app").concat(walk("src/core"));

describe("a long list has a way through it", () => {
    it("keeps the previous/next pair in one component", () => {
        const offenders = files.filter((file) => {
            if (file === COMPONENT || ALLOWLIST[file]) return false;
            const src = readFileSync(file, "utf8");
            return /aria-label=\{(?:common)?[tT]\("(?:common\.)?previousPage"\)\}/.test(src);
        });
        expect(offenders).toEqual([]);
    });

    it("gives every allowlist entry a reason, and drops the stale ones", () => {
        for (const [file, reason] of Object.entries(ALLOWLIST)) {
            expect(files, `${file} is allowlisted but does not exist`).toContain(file);
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
        }
    });

    it("is used by the admin lists that page", () => {
        const paged = [
            "activity-log", "audit-log", "moderation", "revisions", "warnings",
            "users", "email-queue", "media",
            "roles", "api-keys", "ip-blocks", "broadcasts",
        ];
        for (const screen of paged) {
            const src = readFileSync(`src/app/[locale]/(admin)/admin/${screen}/page.tsx`, "utf8");
            expect(src, `${screen} does not use the shared pager`).toContain("<Pagination");
        }
    });

    it("shows both ends and the current neighbourhood", () => {
        expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
        expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
        expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
        expect(pageWindow(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
    });

    it("never elides exactly one page", () => {
        for (let pages = 1; pages <= 40; pages++) {
            for (let page = 1; page <= pages; page++) {
                const window = pageWindow(page, pages);
                const numbers = window.filter((n): n is number => n !== null);
                expect(new Set(numbers).size, `${page}/${pages} repeats a page`).toBe(numbers.length);
                expect(numbers[0], `${page}/${pages} drops page 1`).toBe(1);
                expect(numbers.at(-1), `${page}/${pages} drops the last page`).toBe(pages);
                expect(numbers, `${page}/${pages} drops the current page`).toContain(page);
                for (let i = 1; i < window.length; i++) {
                    if (window[i] === null) {
                        const gap = (window[i + 1] as number) - (window[i - 1] as number);
                        expect(gap, `${page}/${pages} elides a single page`).toBeGreaterThan(2);
                    }
                }
            }
        }
    });

    it("exports the pager to modules", () => {
        const sdk = readFileSync("src/core/sdk/ui.ts", "utf8");
        expect(sdk).toContain("Pagination");
    });
});
