// @vitest-environment node
/**
 * An operator styles a role once, and every screen showing it obeys.
 *
 * `role-css.ts` decides what an operator may write and `RoleName` decides how
 * it is drawn, and between them they got the hard part right twice. What
 * neither of them could do is reach the screens: five places drew a role by
 * hand out of `role.color`, so an operator who wrote a gradient saw it nowhere
 * and an operator who wrote nothing saw the same flat colour they always had.
 * The column had a writer and no readers, which is the mirror of the defect
 * this project already has a name for.
 *
 * So there are two components and this gate, which is the only thing that
 * keeps a sixth screen from being written the same way. A name goes through
 * `RoleName`, the pill beside it through `RoleBadge`, and neither of them is
 * something a screen can approximate with a style attribute - the whole point
 * of the feature is a rule, not an inline colour, because a gradient with
 * `background-clip` or an animation with a keyframe does not survive being
 * flattened into one.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["src/app", "src/core", "module-sources"];

/** The two components that are allowed to know what a role looks like. */
const ALLOWED = [
    "src/core/components/ui/RoleName.tsx",
    "src/core/components/ui/RoleBadge.tsx",
];

/**
 * A style attribute fed from a role's colour. The role editor's own swatch is
 * not one of these: it is a colour picker showing the value being picked.
 */
const HAND_STYLED = /style=\{\{[^}]*\b\w*[Rr]ole\??\.color\b/;

function screens(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) screens(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

describe("how a role is drawn", () => {
    const files = SCANNED.flatMap((dir) => screens(path.join(ROOT, dir)));

    it("finds the screens to check", () => {
        expect(files.length).toBeGreaterThan(200);
    });

    it("goes through the components that read what the operator wrote", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const relative = path.relative(ROOT, file);
            if (ALLOWED.includes(relative)) continue;
            const source = fs.readFileSync(file, "utf8");
            // Comments say `role.color` when they explain why not to.
            const code = stripComments(source);
            if (HAND_STYLED.test(code)) offenders.push(relative);
        }
        expect(
            offenders,
            `use RoleName or RoleBadge from @/core/sdk/ui:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });

    it("has both components to send them to", () => {
        for (const file of ALLOWED) {
            expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
        }
    });

    it("offers both of them to a module", () => {
        const sdk = fs.readFileSync(path.join(ROOT, "src/core/sdk/ui.ts"), "utf8");
        expect(sdk).toContain("RoleName");
        expect(sdk).toContain("RoleBadge");
    });

    it("lets an operator write the styles in the first place", () => {
        // A column with a writer and no editor is a feature nobody can reach.
        const form = fs.readFileSync(
            path.join(ROOT, "src/app/[locale]/(admin)/admin/roles/role-form.tsx"),
            "utf8",
        );
        expect(form).toContain("nameCss");
        expect(form).toContain("badgeCss");
    });
});
