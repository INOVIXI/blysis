// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A draft is something you come back to.
 *
 * The broadcast screen could save one and could send one, and had no way to
 * open it again: the endpoint had GET, POST-to-queue and DELETE, and nothing
 * that changed a subject or a body. So a draft was a message you had written
 * once, could read, could send, and could never correct - which makes it a
 * worse thing than no draft at all, because saving one feels like keeping
 * your work.
 *
 * Only a draft. Once a broadcast is queued the sender is walking the list,
 * and rewriting the body underneath it would send two different messages to
 * two halves of the site. A sent one is a record of what went out, and a
 * record that can be edited is not a record.
 */
interface Row { id: string; subject: string; body: string; status: string }

const update = vi.fn(async (_args?: unknown): Promise<Row> => ({ id: "b1", subject: "Corrected", body: "x", status: "draft" }));
const findUnique = vi.fn(async (_args?: unknown): Promise<Row | null> => ({ id: "b1", subject: "Typo", body: "<p>hi</p>", status: "draft" }));
const isAdmin = vi.fn(async (_id?: string): Promise<boolean> => true);

vi.mock("@/core/lib/db", () => ({
    prisma: {
        emailBroadcast: {
            findUnique: (args: unknown) => findUnique(args),
            update: (args: unknown) => update(args),
            delete: async () => ({}),
        },
    },
}));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: (id: string) => isAdmin(id) }));
vi.mock("@/core/lib/broadcasts", () => ({ queueBroadcast: async () => ({ ok: true }) }));
vi.mock("@/core/lib/prisma-errors", () => ({ prismaErrorOrThrow: () => new Response(null, { status: 404 }) }));

let session: { user: { id: string; role?: string } } | null = { user: { id: "u1" } };
vi.mock("@/core/lib/auth", () => ({ auth: async () => session }));

async function edit(body: unknown) {
    const { PATCH } = await import("@/app/api/v1/broadcasts/[id]/route");
    return PATCH(
        new Request("http://localhost/api/v1/broadcasts/b1", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }) as never,
        { params: Promise.resolve({ id: "b1" }) } as never,
    );
}

beforeEach(() => {
    session = { user: { id: "u1" } };
    for (const spy of [update, findUnique, isAdmin]) spy.mockClear();
    isAdmin.mockResolvedValue(true);
    findUnique.mockResolvedValue({ id: "b1", subject: "Typo", body: "<p>hi</p>", status: "draft" });
});

describe("editing a broadcast", () => {
    it("rewrites a draft", async () => {
        const res = await edit({ subject: "Corrected", body: "<p>fixed</p>" });
        expect(res.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "b1" }, data: { subject: "Corrected", body: "<p>fixed</p>" } }),
        );
    });

    it("refuses one that is already on its way", async () => {
        // Rewriting the body while the sender walks the list would send two
        // different messages to two halves of the site.
        findUnique.mockResolvedValueOnce({ id: "b1", subject: "Typo", body: "x", status: "queued" });
        const res = await edit({ subject: "Corrected" });
        expect(res.status).toBe(409);
        expect(update).not.toHaveBeenCalled();
    });

    it("refuses one that has gone out, because that is a record", async () => {
        findUnique.mockResolvedValueOnce({ id: "b1", subject: "Typo", body: "x", status: "sent" });
        const res = await edit({ subject: "Corrected" });
        expect(res.status).toBe(409);
        expect(update).not.toHaveBeenCalled();
    });

    it("answers a draft that is not there with not found", async () => {
        findUnique.mockResolvedValueOnce(null);
        expect((await edit({ subject: "x" })).status).toBe(404);
    });

    it("refuses an empty subject rather than saving one", async () => {
        const res = await edit({ subject: "   " });
        expect(res.status).toBe(400);
        expect(update).not.toHaveBeenCalled();
    });

    it("refuses somebody who is not signed in", async () => {
        session = null;
        expect((await edit({ subject: "x" })).status).toBe(401);
    });

    it("refuses somebody who is not an administrator", async () => {
        isAdmin.mockResolvedValueOnce(false);
        expect((await edit({ subject: "x" })).status).toBe(403);
    });
});
