// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Recording a click answers with a fact, not with English.
 *
 * The endpoint answered `{ message: "Vote recorded for <site>." }`: a sentence
 * in one language, built on the server, which no page read - the button shows
 * its own translated toast - and which said "vote" about a click, the one
 * word this module keeps off every screen (see `a-click-is-not-a-vote`). It
 * answers the way the module's other writes do.
 */

const written: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "u1", role: null } }) }));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {} }));
vi.mock("@/core/sdk/server", () => ({
    rateLimitForRoleAsync: async () => true,
    readJsonBody: async (request: Request) => request.json(),
    prisma: {
        voteSite: { findUnique: async () => ({ id: "s1", name: "Top Servers" }) },
        $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
            voteLog: {
                findFirst: async () => null,
                create: async ({ data }: { data: Record<string, unknown> }) => { written.push(data); },
            },
        }),
        activityFeedItem: { create: async () => ({}) },
    },
}));

const { POST } = await import("@/modules/vote/api/record/route");

describe("a recorded click answers without a sentence", () => {
    it("says it was recorded and nothing else", async () => {
        const response = await POST(new NextRequest("http://localhost/api/v1/vote/record", {
            method: "POST",
            body: JSON.stringify({ voteSiteId: "s1" }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(written).toHaveLength(1);
    });
});
