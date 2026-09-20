// @vitest-environment node
/**
 * What state a ticket is in is the operator's vocabulary, not ours.
 *
 * Five statuses and four priorities were Prisma enums: `OPEN`,
 * `WAITING_REPLY`, `URGENT`. Good words, and not every support desk's words.
 * A site that triages into "First line" and "With the developers" could not
 * say so, one that never resolves anything could not take `RESOLVED` away,
 * and neither list could grow. Worse, an enum is a database type: adding a
 * value to it is a migration, so "operator-defined" was not a setting anybody
 * could have shipped without one.
 *
 * They are rows now. The five and the four this module ships are seeded and
 * carry a `nameKey`, so they stay translated; a state an operator adds
 * carries the word they typed, which is the only form anybody will ever see
 * it in - the same split `PunishmentScope` makes between a name a reader
 * reads and a key nothing draws.
 *
 * Two flags rather than a hardcoded list of names. `isOpen` is what the
 * dashboard and the counts mean by "open", and `closesTicket` is what stamps
 * `closedAt`; both were `status === "CLOSED" || status === "RESOLVED"`
 * written into three files, which is a rule that cannot survive an operator
 * renaming anything.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    DEFAULT_STATUSES,
    DEFAULT_PRIORITIES,
    stateLabel,
    stateTone,
    openStatusKeys,
    closesTicket,
} from "@/modules/tickets/lib/ticket-states";

const t = Object.assign((key: string) => `said:${key}`, { has: (key: string) => ["open", "closed"].includes(key) });

const ROWS = [
    { key: "OPEN", name: null, nameKey: "open", tone: "info", isOpen: true, closesTicket: false },
    { key: "CLOSED", name: null, nameKey: "closed", tone: "neutral", isOpen: false, closesTicket: true },
    { key: "with-dev", name: "With the developers", nameKey: null, tone: "warning", isOpen: true, closesTicket: false },
];

describe("the states this module ships", () => {
    it("are seeded rather than written into a database type", () => {
        expect(DEFAULT_STATUSES.map((s) => s.key)).toEqual(
            ["OPEN", "IN_PROGRESS", "WAITING_REPLY", "RESOLVED", "CLOSED"],
        );
        expect(DEFAULT_PRIORITIES.map((p) => p.key)).toEqual(["LOW", "MEDIUM", "HIGH", "URGENT"]);
    });

    it("keep their translations, because they are the module's own words", () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), "module-sources/tickets/module.json"), "utf8"));
        for (const locale of ["en", "tr"]) {
            for (const state of [...DEFAULT_STATUSES, ...DEFAULT_PRIORITIES]) {
                expect(typeof state.nameKey, state.key).toBe("string");
                // Public keys on purpose: core strips `adm_` ones from what a
                // public page receives, and these nine words are the same
                // nine either side.
                expect(typeof manifest.translations[locale].tickets[state.nameKey],
                    `${locale} ${state.nameKey}`).toBe("string");
            }
        }
    });

    it("say which of them mean the ticket is still live, and which finish it", () => {
        expect(DEFAULT_STATUSES.filter((s) => s.isOpen).map((s) => s.key))
            .toEqual(["OPEN", "IN_PROGRESS", "WAITING_REPLY"]);
        expect(DEFAULT_STATUSES.filter((s) => s.closesTicket).map((s) => s.key))
            .toEqual(["RESOLVED", "CLOSED"]);
    });
});

describe("what a state is called", () => {
    it("is the module's own word where it has one", () => {
        expect(stateLabel(t, "OPEN", ROWS)).toBe("said:open");
    });

    it("is the operator's word where they typed one", () => {
        expect(stateLabel(t, "with-dev", ROWS)).toBe("With the developers");
    });

    it("is the key itself, readable, for a state nothing names", () => {
        expect(stateLabel(t, "SOME_STATE", ROWS)).toBe("SOME STATE");
    });

    it("wears the tone its row was given, and neutral for one nobody named", () => {
        expect(stateTone("with-dev", ROWS)).toBe("warning");
        expect(stateTone("SOME_STATE", ROWS)).toBe("neutral");
    });
});

describe("which tickets are still open", () => {
    it("is the rows that say so, not a list of names in three files", () => {
        expect(openStatusKeys(ROWS)).toEqual(["OPEN", "with-dev"]);
    });

    it("says which state stamps the day it was finished", () => {
        expect(closesTicket("CLOSED", ROWS)).toBe(true);
        expect(closesTicket("OPEN", ROWS)).toBe(false);
        expect(closesTicket("SOME_STATE", ROWS)).toBe(false);
    });
});

describe("the module around them", () => {
    const read = (rel: string) =>
        fs.readFileSync(path.join(process.cwd(), "module-sources/tickets", rel), "utf8");

    it("holds them as rows, with the column a plain string", () => {
        const schema = read("schema.prisma");
        expect(schema).toContain("model TicketStatus {");
        expect(schema).toContain("model TicketPriority {");
        expect(schema).not.toContain("enum TicketStatus");
        expect(schema).not.toContain("enum TicketPriority");
    });

    it("arrives as a numbered migration, because this module has shipped", () => {
        const dir = path.join(process.cwd(), "module-sources/tickets/migrations");
        const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))
            .map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
        expect(sql).toContain('"TicketStatus"');
        expect(sql).toContain('"TicketPriority"');
        // The column stops being a database type, and the rows already
        // written keep the value they hold.
        expect(sql).toMatch(/ALTER COLUMN "status" TYPE TEXT/);
    });

    it("can be managed on a screen of its own", () => {
        const manifest = JSON.parse(read("module.json"));
        const paths = (manifest.adminRoutes as { path: string }[]).map((r) => r.path);
        expect(paths).toContain("/tickets/states");
    });

    it("asks the rows which tickets are open, rather than naming three", () => {
        const stats = read("api/stats/route.ts");
        expect(stats).not.toContain('["OPEN", "IN_PROGRESS", "WAITING_REPLY"]');
        expect(stats).toContain("openStatusKeys");
    });

    it("sends the dashboard a word rather than the column", () => {
        // The card read `badge: t.status`, so the first screen an operator
        // sees said WAITING_REPLY in English capitals.
        const stats = read("api/stats/route.ts");
        expect(stats).not.toContain("badge: t.status");
        expect(stats).not.toContain('"Deleted user"');
    });
});
