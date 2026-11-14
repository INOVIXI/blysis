// @vitest-environment node
/**
 * A support assistant may draw on the desk's canned responses, the ones that
 * share the most words with the ticket first, and only when the operator
 * switched this source on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let canned: { title: string; content: string }[] = [];
const findMany = vi.fn(async () => canned);

vi.mock("@/core/sdk/server", () => ({
    prisma: { cannedResponse: { findMany } },
    textContains: (fields: string[], term: string) => fields.map((field) => ({ [field]: { contains: term, mode: "insensitive" } })),
    moduleTranslator: async () => (key: string) => `t:${key}`,
}));

const cannedResponses = (await import("@/modules/tickets/hooks/knowledge")).default;
const cannedSource = (await import("@/modules/tickets/hooks/knowledge-source")).default;

const question = { terms: ["refund", "rank"], locale: "en", limit: 1, sources: ["tickets.canned"] };

beforeEach(() => {
    findMany.mockClear();
    canned = [
        { title: "Ranks", content: "A rank arrives within five minutes." },
        { title: "Refunds", content: "A refund for a rank takes three days." },
    ];
});

describe("the canned responses an assistant is handed", () => {
    it("are the ones sharing the most words, up to the limit", async () => {
        expect(await cannedResponses([], question)).toEqual([
            { source: "tickets.canned", title: "Refunds", text: "A refund for a rank takes three days." },
        ]);
    });

    it("are not read at all when the source is off or there is nothing to look for", async () => {
        const earlier = [{ source: "other", title: "x", text: "y" }];
        expect(await cannedResponses(earlier, { ...question, sources: [] })).toBe(earlier);
        expect(await cannedResponses(earlier, { ...question, terms: [] })).toBe(earlier);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("name themselves for the settings screen", async () => {
        expect(await cannedSource([], { locale: "en" })).toEqual([{ id: "tickets.canned", label: "t:knowledge_cannedResponses" }]);
    });
});
