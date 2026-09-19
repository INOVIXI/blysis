// @vitest-environment jsdom
/**
 * What you can do to a row looks the same on every screen.
 *
 * Measured across the panel on 2026-09-19: 40 controls sitting in a row of a
 * list, 23 of them an icon with a name and 17 of them an icon with its label
 * written out beside it. So Edit is a small grey pencil on the downloads
 * screen and a button reading "Edit" two screens over, and an operator moving
 * between them has to look for a different thing each time.
 *
 * Neither shape is wrong on its own. What is wrong is that the choice was
 * made forty times. A row has room for two or three actions and no room for
 * their labels, so the icon carries the meaning and the name is there for
 * whoever cannot see it - which also means the name is not optional, because
 * an icon with no name is a control a screen reader reads as nothing.
 *
 * This is the shape written once. A module passes its own actions; it does
 * not pass a size, a variant or a gap, because those are the things that
 * drifted.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { Pencil, Trash2, ExternalLink } from "lucide-react";
import { stripComments } from "./source-text";

// next-intl's client navigation only resolves inside a Next request. What it
// adds is the locale prefix on an href, which
// navigation-keeps-the-visitors-locale.test.ts already guarantees; here a link
// is a link, and what is being asked is the shape of the strip.
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
}));

const { RowActions } = await import("@/core/components/admin/RowActions");

function draw(onEdit = () => {}, onDelete = () => {}) {
    return render(
        <RowActions
            actions={[
                { icon: Pencil, label: "Edit", onClick: onEdit },
                { icon: ExternalLink, label: "Open the page", href: "/page/rules" },
                { icon: Trash2, label: "Delete", onClick: onDelete, destructive: true },
            ]}
        />,
    );
}

describe("the actions on a row", () => {
    it("names every one of them, because an icon on its own says nothing", () => {
        draw();
        expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
        expect(screen.getByRole("link", { name: "Open the page" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    });

    it("hides the icon from whoever is being read the name", () => {
        const { container } = draw();
        for (const svg of container.querySelectorAll("svg")) {
            expect(svg.getAttribute("aria-hidden")).toBe("true");
        }
    });

    it("does what it was asked when pressed", () => {
        let edited = 0;
        draw(() => { edited++; });
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
        expect(edited).toBe(1);
    });

    it("sends a link somewhere rather than pretending to be a button", () => {
        draw();
        expect(screen.getByRole("link", { name: "Open the page" }).getAttribute("href")).toBe("/page/rules");
    });

    it("marks the destructive one, and only that one", () => {
        const { container } = draw();
        const destructive = [...container.querySelectorAll("button, a")].filter((el) =>
            el.className.includes("text-destructive"),
        );
        expect(destructive).toHaveLength(1);
        expect(within(destructive[0] as HTMLElement).queryByText("Delete")).toBeNull();
        expect(destructive[0].getAttribute("aria-label")).toBe("Delete");
    });

    it("keeps them together in one row, so the column does not wander", () => {
        const { container } = draw();
        const strip = container.firstElementChild as HTMLElement;
        expect(strip.className).toContain("flex");
        expect(strip.className).toMatch(/justify-end/);
    });

    it("draws nothing at all when a row has nothing to offer", () => {
        // An empty strip still takes a column's width, and a table with an
        // actions column and no actions in it reads as broken.
        const { container } = render(<RowActions actions={[]} />);
        expect(container.firstElementChild).toBeNull();
    });

    it("leaves out an action a row does not allow, rather than showing it dead", () => {
        render(
            <RowActions
                actions={[
                    { icon: Pencil, label: "Edit", onClick: () => {} },
                    { icon: Trash2, label: "Delete", onClick: () => {}, hidden: true },
                ]}
            />,
        );
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    });
});

/**
 * The rule only holds while screens use it, and the next list is written by
 * copying the last one.
 */
describe("the lists in the panel", () => {
    const ROOT = process.cwd();

    /**
     * Controls that carry a pencil or a bin and are not a row's actions. A
     * form that lets somebody remove a line they are editing is not a list;
     * the bin belongs to the field, not to a row.
     */
    const NOT_A_ROW: Record<string, string> = {
        "src/app/[locale]/(admin)/admin/settings/footer/FooterColumnCard.tsx":
            "A form for one footer column. The bin removes a link from what is being edited, which is a field's control rather than a row's.",
        "src/app/[locale]/(admin)/admin/settings/navbar/page.tsx":
            "The same: the bin removes an entry from the menu being built, not a row from a list of menus.",
        "module-sources/custom-forms/pages/admin/page.tsx":
            "A form builder. The bin removes a field from the form on screen, which is part of editing it.",
        "module-sources/comparison-table/pages/admin/page.tsx":
            "A table editor. The bins remove a column and a row from the table being written, which is the editing.",
        "module-sources/tickets/pages/admin/tickets/departments/[id]/page.tsx":
            "One department's form. The bin removes a question from the form being written, not a department from a list of them.",
        "module-sources/currency/pages/admin/page.tsx":
            "A list of currencies being composed, not a list of records: each row is a draft with its own boxes and the bin removes a draft from the form, the way the four builders below do.",
        "module-sources/store/pages/admin/orders/NewOrderForm.tsx":
            "The lines of an order being written. The bin takes a line out of what is being composed; there is no record behind it to act on yet.",
        "module-sources/discord-integration/pages/admin/messages/page.tsx":
            "The fields of a message being drafted. Same shape as the form builders: the bin removes a field from the draft rather than acting on a stored row.",
        "module-sources/store/pages/admin/credit-packages/page.tsx":
            "A card per package holding its own editable form and a Save button. Its three controls all wear an icon and their word, consistently; they act on the thing being edited rather than on a row in a list.",
    };

    /**
     * Screens whose rows still draw their own.
     *
     * It is empty. Keeping it, and keeping its ceiling at zero, is what makes
     * the next screen to draw its own pencil land in the failing list rather
     * than quietly on a backlog.
     */
    const NOT_YET: Record<string, string> = {};

    function strip(source: string): string {
        return stripComments(source);
    }

    function adminScreens(): string[] {
        const found: string[] = [];
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "node_modules") walk(full);
                } else if (/\.tsx$/.test(entry.name)) {
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
     * A row's own controls: a pencil or a bin drawn inside the body of a map
     * that gives its output a key.
     *
     * The key is what tells a row from a form. React only asks for one where
     * something is one of many, so a bin inside a keyed map acts on a row and
     * a bin outside one acts on the thing being edited.
     */
    function handRolledRowControls(source: string): boolean {
        for (const m of source.matchAll(/\.map\(/g)) {
            const body = mapBody(source, (m.index ?? 0) + m[0].length - 1);
            if (!/key=\{/.test(body)) continue;
            for (const button of body.matchAll(/<(Button|Link|button)\b/g)) {
                if (/<(Pencil|Trash2|SquarePen)\b/.test(element(body, button.index ?? 0, button[1]))) return true;
            }
        }
        return false;
    }

    /**
     * One element, from its opening tag to its matching close.
     *
     * This used to be "the next four hundred characters after a `<Button`",
     * which is the same fixed-window mistake the note above `mapBody` records
     * having fixed one level out. The coupons screen drew a row with a text
     * Edit button and then an icon bin - two shapes for two actions, which is
     * the whole point of this rule - and the distance from the first `<Button`
     * to that `<Trash2` is nine hundred and forty-six characters, so the scan
     * reported the screen as clean.
     */
    function element(source: string, open: number, tag: string): string {
        let depth = 0;
        const opener = new RegExp(`<${tag}\\b`, "g");
        const closer = new RegExp(`</${tag}>`, "g");
        for (let i = open; i < source.length; i++) {
            opener.lastIndex = i;
            closer.lastIndex = i;
            if (source.startsWith(`<${tag}`, i)) depth++;
            else if (source.startsWith(`</${tag}>`, i)) {
                depth--;
                if (depth === 0) return source.slice(open, i);
            }
            // A self-closing tag never gets a matching close.
            else if (depth === 1 && source.startsWith("/>", i)) return source.slice(open, i);
        }
        return source.slice(open);
    }

    /**
     * The whole of a `.map(...)` call, read to its matching close paren.
     *
     * A fixed window was the first attempt and it reported six screens out of
     * the thirty-five that have one of these controls: a row with an avatar,
     * three columns and a status chip is well past three thousand characters
     * before it reaches its buttons, which are always last.
     */
    function mapBody(source: string, open: number): string {
        let depth = 0;
        let quote: string | null = null;
        for (let i = open; i < source.length; i++) {
            const c = source[i];
            if (quote) {
                if (c === "\\") { i++; continue; }
                if (c === quote) quote = null;
                continue;
            }
            if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
            if (c === "(") depth++;
            else if (c === ")") { depth--; if (depth === 0) return source.slice(open, i + 1); }
        }
        return source.slice(open);
    }

    const screens = adminScreens();

    it("finds the screens, so a broken scan cannot pass quietly", () => {
        expect(screens.length).toBeGreaterThan(120);
    });

    it("keeps the outstanding list to screens that exist, and shrinking", () => {
        for (const rel of Object.keys(NOT_YET)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
        }
        // The number this was written with. A rise means a new screen drew
        // its own pencil rather than asking for one.
        expect(Object.keys(NOT_YET).length).toBeLessThanOrEqual(0);
    });

    it("keeps every exemption to a file that exists, with a reason", () => {
        for (const [rel, reason] of Object.entries(NOT_A_ROW)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
            expect(reason.length, rel).toBeGreaterThan(60);
        }
    });

    it("draws a row's actions through the one component", () => {
        const handRolled = screens
            .filter((rel) => !(rel in NOT_A_ROW) && !(rel in NOT_YET))
            .filter((rel) => handRolledRowControls(strip(fs.readFileSync(path.join(ROOT, rel), "utf8"))));
        expect(handRolled).toEqual([]);
    });
});
