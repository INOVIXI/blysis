import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * recordRevision is called immediately before a destructive update, and it
 * is deliberately non-throwing: a failure to snapshot must not abort the
 * mutation the user asked for. That swallow is the whole contract and it
 * was untested, as was the retention cut-off arithmetic.
 */

const { revision } = vi.hoisted(() => ({
    revision: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        deleteMany: vi.fn(),
    },
}));

vi.mock("@/core/lib/db", () => ({ prisma: { revision }, default: { revision } }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/core/lib/logger", () => ({
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logError },
}));

import {
    recordRevision,
    listRevisions,
    pruneOldRevisions,
} from "@/core/lib/revisions";

beforeEach(() => {
    revision.create.mockReset().mockResolvedValue({ id: "r1" });
    revision.findMany.mockReset().mockResolvedValue([]);
    revision.findUnique.mockReset().mockResolvedValue(null);
    revision.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    logError.mockReset();
});

describe("recordRevision", () => {
    it("stores the snapshot under the resource pair", async () => {
        await recordRevision("blog.article", "a1", { title: "old" }, "update", "u1");

        expect(revision.create.mock.calls[0]![0].data).toEqual({
            resource: "blog.article",
            resourceId: "a1",
            data: { title: "old" },
            action: "update",
            authorId: "u1",
        });
    });

    it("defaults the action to update", async () => {
        await recordRevision("blog.article", "a1", {});
        expect(revision.create.mock.calls[0]![0].data.action).toBe("update");
    });

    it("records a deletion", async () => {
        await recordRevision("blog.article", "a1", {}, "delete", "u1");
        expect(revision.create.mock.calls[0]![0].data.action).toBe("delete");
    });

    it("leaves the author unset for a system-initiated change", async () => {
        await recordRevision("blog.article", "a1", {}, "update");
        expect(revision.create.mock.calls[0]![0].data.authorId).toBeUndefined();
    });

    it("treats a null author as unset rather than writing null", async () => {
        await recordRevision("blog.article", "a1", {}, "update", null);
        expect(revision.create.mock.calls[0]![0].data.authorId).toBeUndefined();
    });

    it("swallows a write failure so the real mutation still proceeds", async () => {
        revision.create.mockRejectedValue(new Error("db down"));

        await expect(recordRevision("blog.article", "a1", {})).resolves.toBeUndefined();
        expect(logError).toHaveBeenCalled();
    });

    it("names the resource in the failure log", async () => {
        revision.create.mockRejectedValue(new Error("db down"));
        await recordRevision("blog.article", "a1", {});

        expect(logError.mock.calls[0]![1]).toEqual({ resource: "blog.article", resourceId: "a1", error: "db down" });
    });
});

describe("listRevisions", () => {
    it("returns an entity's history newest first, with the author", async () => {
        revision.findMany.mockResolvedValue([{ id: "r1" }]);

        await expect(listRevisions("blog.article", "a1")).resolves.toEqual([{ id: "r1" }]);
        const args = revision.findMany.mock.calls[0]![0];
        expect(args.where).toEqual({ resource: "blog.article", resourceId: "a1" });
        expect(args.orderBy).toEqual({ createdAt: "desc" });
        expect(args.include.author.select).toEqual({ id: true, username: true });
    });

    it("caps the page at fifty by default", async () => {
        await listRevisions("blog.article", "a1");
        expect(revision.findMany.mock.calls[0]![0].take).toBe(50);
    });

    it("honours an explicit limit", async () => {
        await listRevisions("blog.article", "a1", 5);
        expect(revision.findMany.mock.calls[0]![0].take).toBe(5);
    });
});

describe("pruneOldRevisions", () => {
    it("keeps ninety days by default", async () => {
        vi.useFakeTimers();
        try {
            const now = new Date("2026-06-01T00:00:00.000Z");
            vi.setSystemTime(now);

            await pruneOldRevisions();

            const cutoff = revision.deleteMany.mock.calls[0]![0].where.createdAt.lt as Date;
            expect(now.getTime() - cutoff.getTime()).toBe(90 * 86_400_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it("honours a shorter retention", async () => {
        vi.useFakeTimers();
        try {
            const now = new Date("2026-06-01T00:00:00.000Z");
            vi.setSystemTime(now);

            await pruneOldRevisions(7);

            const cutoff = revision.deleteMany.mock.calls[0]![0].where.createdAt.lt as Date;
            expect(now.getTime() - cutoff.getTime()).toBe(7 * 86_400_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it("reports how many rows it removed", async () => {
        revision.deleteMany.mockResolvedValue({ count: 12 });
        await expect(pruneOldRevisions()).resolves.toBe(12);
    });

    it("lets a failure surface, unlike recordRevision", async () => {
        revision.deleteMany.mockRejectedValue(new Error("db down"));
        // This one runs from a scheduled job whose result is recorded, so a
        // silent failure would hide unbounded table growth.
        await expect(pruneOldRevisions()).rejects.toThrow("db down");
    });
});
