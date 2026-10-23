// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A warning issued without a reason is stored without one.
 *
 * A warning-type punishment also writes a row to the member's warnings, and
 * when the moderator left the reason empty this module filled the column with
 * "No reason provided". The column is printed as it is on the admin warnings
 * screen, so a Turkish admin read English there for every such warning, and
 * no translation could reach it: the words were data.
 *
 * It is stored empty now, and the screen says in the reader's language that
 * none was given. The rows already written are emptied by this module's own
 * migration, since it is this module's text.
 */

const warnings: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        punishment: { create: async (args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data }) },
        user: { findFirst: async () => ({ id: "member" }) },
        userWarning: { create: async (args: { data: Record<string, unknown> }) => { warnings.push(args.data); return {}; } },
        activityFeedItem: { create: async () => ({}) },
    },
    isAdmin: async () => true,
    logActivity: async () => {},
    readJsonBody: async (request: { json: () => Promise<unknown> }) => request.json(),
    pageParams: () => ({ page: 1, limit: 20, skip: 0, take: 20 }),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin", role: "ADMIN" } }) }));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {}, applyFiltersAsync: async (_: string, v: unknown) => v }));

const { POST } = await import("@/modules/punishments/api/route");

async function issue(body: Record<string, unknown>) {
    return POST(new Request("http://localhost/api/v1/punishments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as never);
}

beforeEach(() => { warnings.length = 0; });

describe("a warning without a reason", () => {
    it("is stored with no reason rather than an English one", async () => {
        await issue({ playerName: "Steve", type: "warning" });

        expect(warnings).toHaveLength(1);
        expect(warnings[0].reason).toBe("");
    });

    it("keeps the reason a moderator did give", async () => {
        await issue({ playerName: "Steve", type: "warning", reason: "griefing the spawn" });

        expect(warnings[0].reason).toBe("griefing the spawn");
    });

    it("empties the rows already written with the English placeholder", () => {
        const dir = path.join(process.cwd(), "module-sources/punishments/migrations");
        const sql = fs.readdirSync(dir).map((file) => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
        expect(sql).toMatch(/UPDATE "UserWarning" SET "reason" = '' WHERE "reason" = 'No reason provided'/);
    });
});
