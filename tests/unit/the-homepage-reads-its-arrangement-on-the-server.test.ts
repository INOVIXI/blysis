// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * The homepage is drawn from its arrangement, and the arrangement is read on
 * the server.
 *
 * The page used to be a client component that walked the widget and section
 * lists itself, so what it drew was decided twice: once by `resolveLayout`
 * for anything that asked, and again in the browser by a copy of the old
 * rules. A saved arrangement would have been honoured by one and ignored by
 * the other. The page cannot be rendered here, so this reads its source; what
 * it draws is `the-homepage-arrangement-is-resolved-in-one-place` and
 * `a-page-layout-is-drawn-with-the-hooks-themes-use`.
 */

const PAGE = stripComments(fs.readFileSync(path.join(process.cwd(), "src/app/[locale]/page.tsx"), "utf8"));

describe("the homepage", () => {
    it("is a server component", () => {
        expect(PAGE).not.toMatch(/^\s*["']use client["']/m);
        expect(PAGE).toMatch(/export default async function HomePage\(/);
    });

    it("reads its arrangement through the loader and draws it with the view", () => {
        expect(PAGE).toContain("loadHomeLayout");
        expect(PAGE).toContain("<PageLayoutView");
    });

    it("no longer walks the widget and section lists itself", () => {
        for (const name of ["ModuleWidgets", "ModuleHomepageSections", "visibleWidgets", "WidgetComponentRegistry", "HomepageSectionRegistry"]) {
            expect(PAGE, name).not.toContain(name);
        }
    });
});
