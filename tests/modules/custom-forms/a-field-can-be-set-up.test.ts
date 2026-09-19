// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A field can be set up, not just chosen.
 *
 * The builder offered six types in a dropdown and no way to configure any of
 * them. Picking "Dropdown" changed a string in the saved JSON and nothing
 * else: there was nowhere to type the options, so the form rendered a
 * `<select>` with one empty entry in it. A visitor could not answer it, and
 * if the field was marked required they could not send the form at all. That
 * is what "changing the type does nothing" looks like from the operator's
 * chair - the row looks identical afterwards and so does the form.
 *
 * The same held for a tick box, whose caption on the public form comes from
 * `placeholder` - a box the builder never showed either, so both seeded forms
 * have a required tick box with no sentence beside it.
 *
 * So a type declares what it needs, the builder asks for exactly that, and
 * the schema refuses a field that has been left unanswerable rather than
 * storing one and finding out on the public page.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MODULE = path.join(ROOT, "module-sources/custom-forms");
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), "utf8");
const manifest = () => JSON.parse(read("module.json"));

/** Every type the module offers, and what each one needs before it works. */
const TYPES = ["text", "email", "url", "tel", "number", "date", "textarea", "select", "radio", "checkbox"] as const;
const NEEDS_OPTIONS = ["select", "radio"];

describe("a form field's type", () => {
    it("is one of a list the module owns, and the list has grown", () => {
        const validations = read("lib/validations.ts");
        for (const type of TYPES) expect(validations, type).toContain(`"${type}"`);
    });

    it("says what it needs, rather than every screen guessing", () => {
        const validations = read("lib/validations.ts");
        expect(validations).toContain("fieldNeeds");
    });

    it("is named in both languages, and only the ones that are offered", () => {
        const translations = manifest().translations;
        const missing: string[] = [];
        for (const locale of ["en", "tr"]) {
            const cat = translations[locale]?.customForms ?? {};
            for (const type of TYPES) {
                const key = `type${type[0].toUpperCase()}${type.slice(1)}`;
                if (typeof cat[key] !== "string") missing.push(`${locale}: ${key}`);
            }
            // A name for a type nobody can pick is a promise the screen does
            // not keep. `typeFile` was one: an upload needs somewhere to put
            // the file, and this module has nowhere.
            for (const key of Object.keys(cat)) {
                if (!key.startsWith("type") || key === "typeText") continue;
                const type = key.slice(4).toLowerCase();
                if (!TYPES.includes(type as typeof TYPES[number]) && /^type[A-Z]/.test(key)) {
                    missing.push(`${locale}: ${key} names a type nobody can choose`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});

describe("a field that needs choices", () => {
    it("is refused when it has none, rather than saved unanswerable", () => {
        const validations = read("lib/validations.ts");
        for (const type of NEEDS_OPTIONS) expect(validations).toContain(type);
        expect(validations).toContain("superRefine");
    });

    it("can be given them in the builder", () => {
        const builder = read("pages/admin/page.tsx");
        expect(builder).toContain("adm_addOption");
        expect(builder).toContain("options");
    });
});

describe("the builder", () => {
    const builder = read("pages/admin/page.tsx");

    it("asks for a caption where a tick box needs one", () => {
        // The public form labels a checkbox with `placeholder`, and there was
        // no box for it, so both seeded forms carry a required tick with
        // nothing beside it.
        expect(builder).toContain("adm_checkboxCaption");
    });

    it("offers help text, which is the other half of asking a question", () => {
        expect(builder).toContain("adm_fieldHelp");
        expect(read("pages/public/[slug]/page.tsx")).toContain("field.help");
    });

    it("lets a field be moved and copied, not only added and deleted", () => {
        expect(builder).toContain("moveField");
        expect(builder).toContain("duplicateField");
    });

    it("keeps two fields from sharing one name, which loses an answer", () => {
        // `data` is keyed by the field's name, so two fields called the same
        // thing means one person's answer overwrites the other.
        expect(builder).toContain("uniqueName");
        expect(read("lib/validations.ts")).toContain("uniqueName");
    });
});

describe("the public form", () => {
    const view = read("pages/public/[slug]/page.tsx");

    it("draws every type the builder can produce", () => {
        for (const type of ["radio", "date", "url", "tel"]) expect(view, type).toContain(type);
    });

    it("passes on the limits a field was given", () => {
        expect(view).toContain("field.min");
        expect(view).toContain("field.maxLength");
    });
});

describe("an answer that arrives", () => {
    /**
     * The endpoint is public and takes anything.
     *
     * `formSubmissionSchema` caps a key at 64 characters and an answer at ten
     * thousand, and that was the whole of it: any key at all was accepted, so
     * a submission could carry fields the form never had - and the admin
     * screen draws every key it is given, so those turn up as answers with no
     * question above them. A required field could be left out entirely,
     * because the only thing asking for it was the browser. A dropdown's
     * answer did not have to be one of its own choices.
     *
     * The form is read out of the database before the submission is written,
     * so the questions are already to hand. Checking against them is not a
     * second query, it is using the one that was already made.
     */
    const lib = read("lib/validations.ts");
    const route = read("api/[slug]/route.ts");

    it("is checked against the questions that were asked", () => {
        expect(lib).toContain("checkAnswers");
        expect(route).toContain("checkAnswers");
    });

    it("has the four things that can be wrong with it named", () => {
        for (const reason of ["unknown_field", "missing_required", "not_an_option", "too_long"]) {
            expect(lib, reason).toContain(reason);
        }
    });

    it("is refused in the visitor's language, not with a code", () => {
        const manifest_ = manifest();
        for (const locale of ["en", "tr"]) {
            const cat = manifest_.translations[locale]?.customForms ?? {};
            for (const reason of ["unknownField", "missingRequired", "notAnOption", "tooLong"]) {
                expect(typeof cat[`err_${reason}`], `${locale} err_${reason}`).toBe("string");
            }
        }
    });
});
