// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A sign on a door can be taken down again.
 *
 * The redirects module shipped a list and a form to add to it, and nothing
 * else. Once a rule was written there was no way to remove it from the panel:
 * an operator who mistyped a target, or who moved a page back, had a
 * permanent rule and a screen that would not let go of it. The only way out
 * was the database.
 *
 * Two things have to happen together, and either alone is a bug an operator
 * would report as "it did not work":
 *
 *   - core holds the rules for a minute, so a rule deleted and not forgotten
 *     keeps sending visitors somewhere for that minute;
 *   - a redirect is a change to what the site does with an address, which is
 *     the kind of change the activity log exists to record.
 */
const deleteRow = vi.fn(async () => ({ id: "r1", from: "/old", to: "/new" }));
const findUnique = vi.fn(async () => ({ id: "r1", from: "/old", to: "/new" }));
const invalidate = vi.fn(async () => {});
const logActivity = vi.fn(async () => {});
const isAdmin = vi.fn(async () => true);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        urlRedirect: {
            findUnique: (args: unknown) => findUnique(args as never),
            delete: (args: unknown) => deleteRow(args as never),
        },
    },
    isAdmin: (id: string) => isAdmin(id as never),
    invalidate: (key: string) => invalidate(key as never),
    logActivity: (entry: unknown) => logActivity(entry as never),
    readJsonBody: async () => ({}),
}));

vi.mock("@/core/sdk", () => ({ resolveRedirect: () => "/new" }));

let session: { user: { id: string } } | null = { user: { id: "u1" } };
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session }));

async function remove(id: string) {
    const { DELETE } = await import("../../../module-sources/url-redirects/api/redirects/[id]/route");
    return DELETE(new Request(`http://localhost/api/v1/url-redirects/${id}`, { method: "DELETE" }) as never, {
        params: Promise.resolve({ id }),
    } as never);
}

beforeEach(() => {
    session = { user: { id: "u1" } };
    for (const spy of [deleteRow, findUnique, invalidate, logActivity, isAdmin]) spy.mockClear();
    isAdmin.mockResolvedValue(true);
});

describe("taking a redirect down", () => {
    it("removes the row it names", async () => {
        const res = await remove("r1");
        expect(res.status).toBe(200);
        expect(deleteRow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1" } }));
    });

    it("forgets the cached rules, or it keeps working for another minute", async () => {
        await remove("r1");
        expect(invalidate).toHaveBeenCalledWith("blysis:routing:redirects");
    });

    it("writes down who changed what the site does with an address", async () => {
        await remove("r1");
        expect(logActivity).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1", entity: "url_redirect", entityId: "r1" }),
        );
    });

    it("answers a rule that is not there with not found, not with success", async () => {
        findUnique.mockResolvedValueOnce(null as never);
        const res = await remove("gone");
        expect(res.status).toBe(404);
        expect(deleteRow).not.toHaveBeenCalled();
    });

    it("refuses somebody who is not signed in", async () => {
        session = null;
        const res = await remove("r1");
        expect(res.status).toBe(401);
        expect(deleteRow).not.toHaveBeenCalled();
    });

    it("refuses somebody who is not an administrator", async () => {
        isAdmin.mockResolvedValueOnce(false as never);
        const res = await remove("r1");
        expect(res.status).toBe(403);
        expect(deleteRow).not.toHaveBeenCalled();
    });
});
