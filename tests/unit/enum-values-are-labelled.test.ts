import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A database enum is not a label.
 *
 * `TicketStatus`, `OrderStatus`, `ArticleStatus` and the loose status strings
 * beside them hold `IN_PROGRESS`, `REFUNDED`, `PUBLISHED`. Rendering the
 * column is rendering English at best, and SQL vocabulary at worst: a Turkish
 * visitor read "WAITING_REPLY" on their own support ticket and "mute" in the
 * punishment list, on a page whose every other word was translated. Twice the
 * translation already existed and the screen simply never asked for it: the
 * punishments filter above the table read from a key map that the table cell
 * below it ignored, and five `adm_orderStatus_*` messages sat in the store's
 * manifest, in both locales, referenced by nothing at all.
 *
 * Worse, the customer's own order tab mapped each status to a
 * `tab_orders_status*` key the manifest never declared. next-intl renders the
 * key path rather than throwing, so a completed order read
 * "store.tab_orders_statusCompleted".
 *
 * The rule: a JSX text node may not be a bare `x.status` / `x.type` /
 * `x.priority` / `x.state`. Values that are genuinely identifiers rather than
 * labels are listed below with a reason.
 */

const ROOT = path.resolve(__dirname, "../..");
const SCAN = ["module-sources", "src/app", "src/core/components"];

/**
 * Renders that are an identifier on purpose, not a label. Each entry is the
 * repo-relative file and the expression, with why it stays.
 */
const IDENTIFIERS_BY_DESIGN: Record<string, string> = {
    "src/app/[locale]/(admin)/admin/settings/theme/page.tsx::theme.type":
        "A theme's type is its packaging ('installed', 'builtin'), shown beside its version string. It names a thing, not a state.",
    "src/app/[locale]/(admin)/admin/dev/page.tsx::l.type":
        "The developer hook inspector. Its whole subject is the literal hook and listener names, which are code and are the same in every locale.",
    "module-sources/store/pages/admin/products/[id]/edit/page.tsx::v.type":
        "A product variable's input type ('text', 'number'), shown to the admin who typed it into the field editor beside it.",
    "src/app/[locale]/(admin)/admin/roles/page.tsx::role.priority":
        "A role's priority is the integer the admin types into the field above it, and the number is what they need to read back.",
    "src/app/[locale]/(admin)/admin/settings/rate-limits/page.tsx::role.priority":
        "The same integer, shown beside each role so the admin can see which bucket wins when two roles overlap.",
};

/** A JSX child that is exactly one member expression, optionally .replace()d. */
const RENDER = /\{\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*\.(?:status|type|state|priority|moderationState))\s*(?:\.replace\([^)]*\)\s*)?\}/g;

export function rawEnumRenders(file: string, source: string): string[] {
    const found: string[] = [];
    for (const line of source.split("\n")) {
        for (const match of line.matchAll(RENDER)) {
            // `${x.type}` inside a template literal is a key or an id, not a
            // rendered label.
            if (line[match.index - 1] === "$") continue;
            const before = line.slice(0, match.index).trimEnd();
            // An attribute value (`prop={x.type}`) is not a rendered label.
            if (before.endsWith("=") || before.endsWith("={")) continue;
            // A key inside a lookup (`map[x.type]`) is not one either.
            if (line[match.index - 1] === "[" || line[match.index + match[0].length] === "]") continue;
            const entry = `${file}::${match[1]}`;
            if (entry in IDENTIFIERS_BY_DESIGN) continue;
            found.push(entry);
        }
    }
    return found;
}

function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const item of fs.readdirSync(current, { withFileTypes: true })) {
            if (item.name === "node_modules") continue;
            const full = path.join(current, item.name);
            if (item.isDirectory()) walk(full);
            else if (item.name.endsWith(".tsx")) out.push(full);
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
}

describe("what a reader sees is a label, not a column", () => {
    it("renders no raw enum value anywhere", () => {
        const offences: string[] = [];
        for (const base of SCAN) {
            for (const file of tsxFiles(path.join(ROOT, base))) {
                offences.push(...rawEnumRenders(path.relative(ROOT, file), fs.readFileSync(file, "utf8")));
            }
        }
        expect(offences.join("\n")).toBe("");
    });

    it("every allowlisted render still exists and still says why", () => {
        for (const [entry, reason] of Object.entries(IDENTIFIERS_BY_DESIGN)) {
            const [file, expression] = entry.split("::");
            const full = path.join(ROOT, file);
            expect(fs.existsSync(full), `${file} is gone; drop its entry`).toBe(true);
            expect(fs.readFileSync(full, "utf8"), entry).toContain(expression);
            expect(reason.length, entry).toBeGreaterThan(40);
        }
    });

    it("the message each screen now asks for actually exists", () => {
        const manifest = (id: string) =>
            JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8"));
        const expectKeys = (id: string, namespace: string, keys: string[]) => {
            const translations = manifest(id).translations as Record<string, Record<string, Record<string, string>>>;
            for (const locale of Object.keys(translations)) {
                for (const key of keys) {
                    expect(translations[locale][namespace], `${id} ${locale} ${namespace}.${key}`).toHaveProperty(key);
                }
            }
        };
        /*
         * The nine public words only. A ticket's states are rows now, and a
         * row's `nameKey` has to resolve on both sides - core strips `adm_`
         * keys from the catalogue a public page receives - so the five admin
         * copies stopped being read the day the panel started asking the row
         * what it is called.
         */
        expectKeys("tickets", "tickets", ["open", "inProgress", "waitingReply", "resolved", "closed", "low", "medium", "high", "urgent"]);
        expectKeys("store", "store", ["tab_orders_statusPending", "tab_orders_statusProcessing", "tab_orders_statusCompleted", "tab_orders_statusCancelled", "tab_orders_statusRefunded", "adm_orderStatus_PENDING", "adm_orderStatus_REFUNDED"]);
        expectKeys("punishments", "punishments", ["ban", "mute", "kick", "warning", "console"]);
        expectKeys("referral", "referral", ["pending", "completed", "rewarded", "creditsUnit"]);
        expectKeys("blog", "blog", ["adm_draft", "adm_published", "adm_scheduled", "adm_archived"]);
        // Three states now, not one word for one of them. `new` had a name
        // and `read` and `handled` were drawn as the column, on a screen that
        // could not change any of the three anyway.
        expectKeys("custom-forms", "customForms", ["adm_state_new", "adm_state_read", "adm_state_handled"]);

        for (const locale of ["en", "tr"]) {
            const core = JSON.parse(fs.readFileSync(path.join(ROOT, "messages-core", `${locale}.json`), "utf8"));
            for (const key of ["emailQueue_pending", "emailQueue_sending", "emailQueue_sent", "emailQueue_failed", "broadcasts_draft", "broadcasts_queued", "broadcasts_sending", "broadcasts_sent", "broadcasts_failed"]) {
                expect(core.admin, `${locale} admin.${key}`).toHaveProperty(key);
            }
        }
    });
});

describe("the check itself", () => {
    it("catches a status rendered as a label", () => {
        expect(rawEnumRenders("a.tsx", "<span>{ticket.status}</span>")).toEqual(["a.tsx::ticket.status"]);
    });

    it("catches one laundered through .replace", () => {
        expect(rawEnumRenders("a.tsx", '<span>{ticket.status.replace(/_/g, " ")}</span>')).toEqual(["a.tsx::ticket.status"]);
    });

    it("leaves an attribute value alone", () => {
        expect(rawEnumRenders("a.tsx", "<Select value={form.type} />")).toEqual([]);
    });

    it("leaves a lookup key alone", () => {
        expect(rawEnumRenders("a.tsx", "<span className={colors[t.status]}>x</span>")).toEqual([]);
    });

    it("accepts a translated label", () => {
        expect(rawEnumRenders("a.tsx", "<span>{labelFor(t, STATUS_KEYS, ticket.status)}</span>")).toEqual([]);
    });
});
