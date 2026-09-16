import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A screen with nothing on it says which kind of nothing it is.
 *
 * A list has two ways to be empty: nothing was created yet, or the request
 * behind it never came back. Forty screens rendered the same sentence for
 * both. They read their content, dropped every failure on the floor, and
 * showed "no orders yet", "no categories", "all essential modules are
 * installed" - with a green tick - for a server that was down, a session that
 * had expired or a connection that was not there.
 *
 * Two shapes did it. `.catch(() => setLoading(false))` turns a rejection into
 * a finished load with no rows, and `.then(r => r.ok ? r.json() : { items: []
 * })` substitutes an empty answer for a refusal without the rejection ever
 * happening. Both look deliberate in review, which is why there were so many.
 *
 * The two that cost the most: the observability page said "no errors" when it
 * had not heard back, and the widget settings screen showed every widget at
 * its default after a failed load, so saving wrote those defaults over what
 * the admin actually had.
 *
 * This checks every read that feeds a screen with an empty state. What may
 * stay silent is listed below with the reason, one entry per file.
 */

const ROOT = process.cwd();
const DIRS = ["src/app", "src/core", "module-sources"];

/**
 * Reads whose failure is not presented to anyone as an answer. Each entry is
 * a decision, not a backlog.
 */
const MAY_STAY_SILENT: Record<string, string> = {
    "module-sources/in-app-notifications/components/NotificationBell.tsx":
        "Both are mark-read PATCHes, not reads. Each checks res.ok before it touches the badge.",
    "module-sources/store/pages/admin/products/[id]/edit/page.tsx":
        "Populates the command, variable and server pickers inside the edit form. The product itself is guarded, so a failed load no longer renders a blank form that could be saved over the product.",
    "module-sources/store/pages/admin/products/new/page.tsx":
        "Populates the category picker on a create form. Nothing is claimed about the catalogue, and the field is required, so an empty picker cannot be submitted.",
    "module-sources/store/pages/public/cart/page.tsx":
        "Both are capability probes: which payment gateways are installed, and whether the credits module is. No answer means the option is not offered, which is what a failure should mean.",
    "src/app/[locale]/(admin)/admin/components/dashboard-client.tsx":
        "Module-contributed dashboard cards and sections. On a failure the panel is absent rather than empty, and core's own KPI widgets stay on screen beside it.",
    "src/app/[locale]/(admin)/admin/observability/page.tsx":
        "Four independent panels; the two that answer a question - recent errors and failed emails - carry their own failure flags. Health and stats render nothing rather than a clean reading.",
    "src/app/[locale]/(admin)/admin/roles/page.tsx":
        "Loads the module permission groups offered in the role editor. The comment says what a failure means: core permissions only.",
};

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

const FILES = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f);
const code = (s: string) => stripComments(s);

/** True when the file renders an explicit "there is nothing here" branch. */
function hasEmptyState(source: string): boolean {
    return /\.length === 0 \?|\.length > 0 \?|length === 0 &&/.test(source);
}

/** The text between `.catch(` and its matching `)`. */
function catchBody(source: string, at: number): string {
    let i = at;
    let depth = 1;
    while (i < source.length && depth > 0) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") depth--;
        i++;
    }
    return source.slice(at, i - 1);
}

/** A catch that leaves no trace anywhere a reader or an operator can see. */
function silentCatches(source: string): number[] {
    const found: number[] = [];
    for (const m of source.matchAll(/\.catch\(/g)) {
        // `res.json().catch(...)` guards a parse of an error body, not a read.
        if (/\.json\(\)$/.test(source.slice(Math.max(0, m.index! - 30), m.index!))) continue;
        const body = catchBody(source, m.index! + m[0].length);
        if (/toast\.|set\w*Error|set\w*Failed|console\.|log\.|throw|reject|notFound\(|redirect\(/.test(body)) continue;
        found.push(source.slice(0, m.index!).split("\n").length);
    }
    return found;
}

describe("a read that fails", () => {
    it("is not reported as an empty result", () => {
        const silent: string[] = [];
        for (const file of FILES) {
            const source = code(fs.readFileSync(file, "utf8"));
            if (!hasEmptyState(source)) continue;
            if (MAY_STAY_SILENT[rel(file)]) continue;
            for (const line of silentCatches(source)) silent.push(`${rel(file)}:${line}`);
        }
        expect(silent).toEqual([]);
    });

    it("is never swapped for an empty answer inline", () => {
        // `.then(r => r.ok ? r.json() : { items: [] })` never rejects, so the
        // catch below it cannot help. Four screens read this way. `null` and
        // `Promise.reject` are the honest spellings: one is checked by the
        // caller, the other reaches the catch.
        const swapped: string[] = [];
        for (const file of FILES) {
            const source = fs.readFileSync(file, "utf8");
            if (!hasEmptyState(code(source))) continue;
            if (MAY_STAY_SILENT[rel(file)]) continue;
            for (const m of source.matchAll(/(\w+)\.ok \? \1\.json\(\) : (?!null|Promise\.reject)/g)) {
                swapped.push(`${rel(file)}:${source.slice(0, m.index!).split("\n").length}`);
            }
        }
        expect(swapped).toEqual([]);
    });

    it("every file listed as deliberately silent still exists and still has a read", () => {
        for (const [file, reason] of Object.entries(MAY_STAY_SILENT)) {
            const full = path.join(ROOT, file);
            expect(fs.existsSync(full), `${file}: ${reason}`).toBe(true);
            expect(fs.readFileSync(full, "utf8"), file).toContain("fetch(");
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
        }
    });
});

describe("the panel a failed read shows instead", () => {
    const wrapper = "src/core/components/ui/load-failed.tsx";

    it("exists, is reachable from a module, and says so out loud", () => {
        const source = fs.readFileSync(path.join(ROOT, wrapper), "utf8");
        expect(source).toContain('role="alert"');
        expect(source).toContain('t("loadFailed")');
        expect(fs.readFileSync(path.join(ROOT, "src/core/sdk/ui.ts"), "utf8")).toContain("LoadFailed");
        for (const locale of ["en", "tr"]) {
            const messages = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
            expect(messages.common.loadFailed, locale).toBeTruthy();
            expect(messages.common.retry, locale).toBeTruthy();
        }
    });

    it("offers a way back, because these screens load once on mount", () => {
        const source = fs.readFileSync(path.join(ROOT, wrapper), "utf8");
        expect(source).toContain("onRetry");
        const unretryable = FILES.filter((f) => {
            const s = fs.readFileSync(f, "utf8");
            return s.includes("<LoadFailed") && !s.includes("onRetry");
        }).map(rel);
        expect(unretryable).toEqual([]);
    });

    it("a retry that works clears the failure", () => {
        // Every screen that can raise the flag must also lower it, or the
        // panel outlives the outage and a working retry changes nothing.
        const stuck = FILES.filter((f) => {
            const s = code(fs.readFileSync(f, "utf8"));
            if (!s.includes("<LoadFailed")) return false;
            const setters = Array.from(s.matchAll(/set(\w*Failed)\(true\)/g), (m) => m[1]);
            return setters.some((name) => !s.includes(`set${name}(false)`));
        }).map(rel);
        expect(stuck).toEqual([]);
    });
});

describe("the two screens this cost the most", () => {
    it("observability does not read clean when it did not hear back", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(admin)/admin/observability/page.tsx"), "utf8");
        expect(source).toContain("setErrorsFailed(!errorsRes?.data)");
        expect(source).toContain("setEmailsFailed(!emailsRes?.data)");
        const errorsPanel = source.slice(source.indexOf("errorsFailed ?"));
        expect(errorsPanel.indexOf("observability_noErrors")).toBeGreaterThan(errorsPanel.indexOf("LoadFailed"));
    });

    it("widget settings cannot be saved over settings it never read", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/widgets/page.tsx"), "utf8");
        // The save button is offered only once the current visibility has
        // actually been read, whichever corner of the screen it is drawn in.
        const guard = /sortedWidgets\.length > 0 && !loadFailed \?[\s\S]{0,400}?widgets_save/;
        expect(source).toMatch(guard);
    });

    it("a user who could not be read is not reported as missing", () => {
        // `if (!user)` renders "user not found", which tells the operator to
        // stop looking. A 500 has to reach a different branch. A real 404
        // still goes through, since that answer is the truth.
        const source = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(admin)/admin/users/[id]/page.tsx"), "utf8");
        expect(source).toContain("r.status !== 404");
        expect(source.indexOf("if (loadFailed)")).toBeLessThan(source.indexOf("users_notFound"));
    });

    it("a module that could not be read is not reported as uninstalled", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(admin)/admin/modules/[moduleId]/page.tsx"), "utf8");
        expect(source.indexOf("if (loadFailed)")).toBeLessThan(source.indexOf("if (!mod)"));
    });

    it("a theme marketplace that did not load is not an empty marketplace", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/theme/page.tsx"), "utf8");
        expect(source).toContain("marketplaceFailed");
        expect(source).toContain("readJson");
    });

    it("a blog article edit form is not offered with blank fields", () => {
        // `articleData.article || articleData` is truthy for an error body,
        // so the form filled itself with empty strings and saving wrote them
        // over the article.
        const source = fs.readFileSync(
            path.join(ROOT, "module-sources/blog/pages/admin/articles/[id]/edit/page.tsx"),
            "utf8",
        );
        expect(source).toContain("if (!r.ok) throw new Error");
        expect(source.indexOf("if (loadFailed)")).toBeLessThan(source.indexOf("adm_editArticle"));
    });

    it("a product edit form is not offered with blank fields", () => {
        const source = fs.readFileSync(
            path.join(ROOT, "module-sources/store/pages/admin/products/[id]/edit/page.tsx"),
            "utf8",
        );
        expect(source).toContain("if (failed) {");
        expect(source.indexOf("if (failed) {")).toBeLessThan(source.indexOf("adm_editProduct"));
    });
});
