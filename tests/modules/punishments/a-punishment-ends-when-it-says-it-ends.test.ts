// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A punishment ends when the form says it ends.
 *
 * The create form's most prominent time field is "Duration (e.g. 7d, 24h,
 * permanent)", and `duration` is a free text column that nothing ever reads.
 * `punishmentStatus` decides whether a punishment is still in force from
 * `expiresAt` alone, and `expiresAt` was only ever set from a second, separate
 * box below it labelled "End date (optional)". So an operator who typed 7d and
 * left the optional box alone - which is what the field is for - issued a
 * permanent ban that showed as Active for ever, and the panel told them
 * nothing.
 *
 * Two boxes for one answer, one of which is decorative. The shorthand is the
 * one an operator reaches for, so the shorthand is what decides, and the date
 * is computed from it.
 *
 * The parsing lives in the module's lib because the endpoint is not the only
 * thing that will want it: a punishment arriving from a game server carries
 * the same kind of string.
 */

const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "p1", ...(args?.data ?? {}) }));
const findFirst = vi.fn(async () => null);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        punishment: { create: (args: never) => create(args), findFirst: () => findFirst(), findMany: async () => [] },
        user: { findFirst: () => findFirst() },
        userWarning: { create: async () => ({}), count: async () => 0 },
        punishmentScope: { findMany: async () => [] },
    },
    isAdmin: async () => true,
    logActivity: async () => {},
    readJsonBody: async (request: { json: () => Promise<unknown> }) => request.json(),
    pageParams: () => ({ page: 1, limit: 20, skip: 0, take: 20 }),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin", role: "ADMIN" } }) }));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {}, applyFiltersAsync: async (_: string, v: unknown) => v }));

const { parseDuration } = await import("@/modules/punishments/lib/duration");

describe("a punishment's length", () => {
    const FROM = new Date("2026-06-01T00:00:00Z");

    it("is read from the shorthand an operator types", () => {
        expect(parseDuration("7d", FROM)?.toISOString()).toBe("2026-06-08T00:00:00.000Z");
        expect(parseDuration("24h", FROM)?.toISOString()).toBe("2026-06-02T00:00:00.000Z");
        expect(parseDuration("30m", FROM)?.toISOString()).toBe("2026-06-01T00:30:00.000Z");
        expect(parseDuration("2w", FROM)?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    });

    it("understands 'permanent' as no end at all", () => {
        expect(parseDuration("permanent", FROM)).toBeNull();
        expect(parseDuration("", FROM)).toBeNull();
        expect(parseDuration(null, FROM)).toBeNull();
    });

    it("refuses what it cannot read, rather than guessing", () => {
        // `undefined` is different from `null` here: null is "no end", and
        // undefined is "that is not a length I understand", which the caller
        // turns into a 400 rather than storing a permanent ban.
        expect(parseDuration("next tuesday", FROM)).toBeUndefined();
        expect(parseDuration("7", FROM)).toBeUndefined();
        expect(parseDuration("-3d", FROM)).toBeUndefined();
    });
});

describe("the create endpoint", () => {
    beforeEach(() => create.mockClear());

    it("ends a punishment the shorthand gave a length to", async () => {
        const { POST } = await import("@/modules/punishments/api/route");
        const res = await POST(new Request("http://localhost/api/v1/punishments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName: "rune", type: "tempban", duration: "7d" }),
        }) as never);
        expect(res.status, JSON.stringify(await res.json().catch(() => null))).toBeLessThan(300);
        expect(create.mock.calls[0][0].data.expiresAt).toBeInstanceOf(Date);
    });

    it("leaves it open where the operator asked for permanent", async () => {
        const { POST } = await import("@/modules/punishments/api/route");
        await POST(new Request("http://localhost/api/v1/punishments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName: "rune", type: "ban", duration: "permanent" }),
        }) as never);
        expect(create.mock.calls[0][0].data.expiresAt).toBeNull();
    });
});

describe("the punishments screen", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const screen = fs.readFileSync(path.join(ROOT, "module-sources/punishments/pages/admin/page.tsx"), "utf8");

    it("does not open a new punishment with a settings editor", () => {
        /*
         * Clicking "New punishment" showed a manager for places - a list of
         * servers with a Save and a Delete each and an "Add new place"
         * button - above the box for the player's name. A settings panel is
         * not the first thing somebody issuing a ban is asking for, and this
         * is the whole of why the screen could not be worked out.
         */
        const form = screen.slice(screen.indexOf("if (showForm)"));
        expect(form).not.toContain("<ScopeManager");
    });

    it("lets a punishment be given a place, since that is what a place is for", () => {
        // `restrictsSite` on a scope decides whether a game ban closes the
        // website account. The manager could declare places and the form
        // could not use one, so the column was only ever filled by a game
        // server reporting in.
        expect(screen).toContain("scopeId");
    });
});
