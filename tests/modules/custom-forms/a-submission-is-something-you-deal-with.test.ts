// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A form submission is something an operator deals with, not something they
 * watch accumulate.
 *
 * The screen listed every submission ever made, newest first, fifty at a
 * time, and offered one control: which form. Nothing else. A row carried a
 * status badge - `new`, `read`, `handled` - and no endpoint in the module
 * ever wrote that column, so those three words were decided when the row was
 * created and could never be changed by anybody. Two of them had no
 * translation either, so a Turkish screen read "handled" and "read" in
 * English beside a "Yeni" that had been given one.
 *
 * Nothing could be deleted either. A form left open collects whatever is sent
 * to it, including the runs of nonsense that every public form collects, and
 * the panel's answer to that was to page through it.
 *
 * And a row opened to show the answers against `your_email` and `what_broke`
 * - the field's `name`, with its underscores swapped for spaces and its first
 * letter raised. The form declares a `label` for every field, which is the
 * sentence the person answering actually read; the list simply never asked
 * for it.
 *
 * So: the three states are named, an operator can move a submission between
 * them, a submission can be deleted, the list can be searched and narrowed by
 * state, and an answer is shown under the question that was asked.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MODULE = path.join(ROOT, "module-sources/custom-forms");
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), "utf8");
const manifest = () => JSON.parse(read("module.json"));

/** The states the module allows a submission to be in. */
const STATES = ["new", "read", "handled"] as const;

describe("a submission's state", () => {
    it("is one of a list the module owns, rather than any string at all", () => {
        const validations = read("lib/validations.ts");
        expect(validations).toContain("SUBMISSION_STATES");
        for (const state of STATES) expect(validations).toContain(`"${state}"`);
    });

    it("is named in both languages", () => {
        const translations = manifest().translations;
        const missing: string[] = [];
        for (const locale of ["en", "tr"]) {
            const cat = translations[locale]?.customForms ?? {};
            for (const state of STATES) {
                const key = `adm_state_${state}`;
                if (typeof cat[key] !== "string" || !cat[key].trim()) missing.push(`${locale}: ${key}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("is never printed as the column it is stored in", () => {
        const screen = read("pages/admin/submissions/page.tsx");
        expect(screen).not.toContain("{sub.status}");
        expect(screen).toContain("adm_state_");
    });

    it("can be changed, which is the whole point of having one", () => {
        const route = read("api/submissions/[id]/route.ts");
        expect(route).toContain("export async function PATCH");
        expect(route).toContain("SUBMISSION_STATES");
    });
});

describe("a submission", () => {
    it("can be deleted", () => {
        expect(read("api/submissions/[id]/route.ts")).toContain("export async function DELETE");
    });

    it("has both of those declared, so core mounts them", () => {
        const api = manifest().api as { path: string }[];
        expect(api.map((entry) => entry.path)).toContain("/forms/submissions/[id]");
    });

    it("shows an answer under the question that was asked", () => {
        // The form's `label`, not its `name`. The list has to be given the
        // fields to do that, so the endpoint sends them.
        expect(read("api/submissions/route.ts")).toContain("fields: true");
        expect(read("pages/admin/submissions/page.tsx")).toContain("fieldLabel");
    });
});

describe("the submissions list", () => {
    it("can be searched, and narrowed by state, at the endpoint", () => {
        const route = read("api/submissions/route.ts");
        expect(route).toContain('searchParams.get("q")');
        expect(route).toContain('searchParams.get("status")');
    });

    it("sends both from the screen, because a filter the list ignores is worse than none", () => {
        const screen = read("pages/admin/submissions/page.tsx");
        expect(screen).toContain('params.set("q"');
        expect(screen).toContain('params.set("status"');
    });

    it("is narrowed by the strip every other admin list uses", () => {
        expect(read("pages/admin/submissions/page.tsx")).toContain("FilterChips");
    });
});
