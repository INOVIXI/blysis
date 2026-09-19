// @vitest-environment jsdom
/**
 * A field that names another record offers the records.
 *
 * The bulk discount screen asked for a product id and a category id in two
 * text boxes, and the creator code screen asked for a user id in a third.
 * There is nowhere in the panel that shows a category's id, so the only way
 * to fill one in was to open the database - and a mistyped id is not refused
 * by anything, it just makes a discount that never applies.
 *
 * So the field searches and the operator picks. What is stored is still the
 * id; what is shown is the name, because the name is the only part anybody
 * knows.
 *
 * Two things it has to get right beyond the obvious:
 *
 *   - editing an existing row has to show the name of what is already
 *     chosen, not the id it was saved as;
 *   - an id that no longer resolves has to say so rather than render blank,
 *     because a blank box on an edit form reads as "nothing is set" and
 *     saving would then clear it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

const asked: string[] = [];

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const ROWS = [
    { id: "c1", name: "Ranks", slug: "ranks" },
    { id: "c2", name: "Keys", slug: "keys" },
    { id: "c3", name: "Boosters", slug: "boosters" },
];

beforeEach(() => {
    asked.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        asked.push(String(url));
        const term = new URL(String(url), "http://x").searchParams.get("search") ?? "";
        const rows = term ? ROWS.filter((r) => r.name.toLowerCase().includes(term.toLowerCase())) : ROWS;
        return new Response(JSON.stringify({ categories: rows }), { status: 200 });
    }));
});

const { ReferencePicker } = await import("@/core/components/admin/ReferencePicker");

function draw(props: Partial<React.ComponentProps<typeof ReferencePicker>> = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <ReferencePicker
                value=""
                onChange={() => {}}
                label="Category"
                endpoint="/api/v1/store/categories"
                listKey="categories"
                labelField="name"
                {...props}
            />
        </NextIntlClientProvider>,
    );
}

describe("picking a record instead of typing its id", () => {
    it("offers a box to search by name", async () => {
        draw();
        expect(await screen.findByRole("combobox", { name: "Category" })).toBeTruthy();
    });

    it("asks the endpoint for what was typed", async () => {
        draw();
        await screen.findByRole("combobox", { name: "Category" });
        fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "boost" } });
        await waitFor(() => expect(asked.at(-1)).toContain("search=boost"), { timeout: 5000 });
    });

    it("stores the id and shows the name", async () => {
        let stored = "";
        draw({ onChange: (id: string) => { stored = id; } });
        fireEvent.focus(await screen.findByRole("combobox", { name: "Category" }));
        const option = await screen.findByRole("option", { name: /Ranks/ });
        fireEvent.click(option);
        expect(stored).toBe("c1");
    });

    it("shows the name of what is already chosen, not the id it was saved as", async () => {
        draw({ value: "c2" });
        await waitFor(() =>
            expect((screen.getByRole("combobox", { name: "Category" }) as HTMLInputElement).value).toBe("Keys"),
            { timeout: 5000 },
        );
    });

    it("prefers a name the caller already has, rather than asking again", async () => {
        draw({ value: "c2", valueLabel: "Keys" });
        expect((screen.getByRole("combobox", { name: "Category" }) as HTMLInputElement).value).toBe("Keys");
    });

    it("says so when the id no longer names anything", async () => {
        // Blank would read as "nothing is set", and saving would then clear a
        // reference that was only unresolvable, not absent.
        draw({ value: "gone" });
        expect(await screen.findByText(/gone/)).toBeTruthy();
    });

    it("lets the field be emptied deliberately", async () => {
        let stored = "c1";
        draw({ value: "c1", valueLabel: "Ranks", onChange: (id: string) => { stored = id; } });
        fireEvent.click(screen.getByRole("button", { name: MESSAGES.common.clear }));
        expect(stored).toBe("");
    });
});

/**
 * The rule only holds while the fields use it, and the next form is written
 * by copying the last one.
 */
describe("the fields that name another record", () => {
    const ROOT = process.cwd();

    /**
     * Keys that end in Id and are not a reference to something in this
     * database. Each line is a decision.
     */
    const NOT_OURS: Record<string, string> = {
        "module-sources/cloudflare-r2/pages/admin/page.tsx":
            "A Cloudflare account id. It is somebody else's identifier, copied out of their dashboard, and this site has no list of them to offer.",
        "module-sources/discord-widget/pages/admin/page.tsx":
            "A Discord server id, copied out of Discord. The same: not a record here.",
    };

    function screens(): string[] {
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
     * The whole of the object a `key: "...Id"` sits in, read from its opening
     * brace to the matching close.
     *
     * A lazy window was the first attempt and it stopped at the first `}` it
     * met - which, once a field carried a nested `reference: { ... }`, was
     * that nested object's. So a field could lose its `type` and the rule
     * still passed, because the text it was reading no longer contained the
     * word it was looking for.
     */
    function fieldObject(source: string, keyAt: number): string {
        const open = source.lastIndexOf("{", keyAt);
        if (open === -1) return "";
        let depth = 0;
        for (let i = open; i < source.length; i++) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") {
                depth--;
                if (depth === 0) return source.slice(open, i + 1);
            }
        }
        return source.slice(open);
    }

    const FIELD_KEY = /key:\s*"(\w*(?:Id|Ids))"/g;

    it("finds the screens, so a broken scan cannot pass quietly", () => {
        expect(screens().length).toBeGreaterThan(120);
    });

    it("offers the records rather than asking for an id", () => {
        const typed: string[] = [];
        for (const rel of screens()) {
            if (rel in NOT_OURS) continue;
            const source = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
            if (!source.includes("fields={[")) continue;
            for (const m of source.matchAll(FIELD_KEY)) {
                const body = fieldObject(source, m.index ?? 0);
                if (!body.includes("label:")) continue;
                const kind = /type:\s*"(\w+)"/.exec(body)?.[1] ?? "text";
                // A select already offers the records; a reference searches
                // for them. Anything else is a box asking for an id.
                if (kind === "select" || kind === "reference") continue;
                typed.push(`${rel}: ${m[1]} is a ${kind} field`);
            }
        }
        expect(typed).toEqual([]);
    });

    it("keeps every exemption to a screen that exists, with a reason", () => {
        for (const [rel, reason] of Object.entries(NOT_OURS)) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
            expect(reason.length, rel).toBeGreaterThan(60);
        }
    });
});
