// @vitest-environment node
/**
 * The assistant's drafts are for whoever answers tickets, and its record and
 * settings for its managers.
 *
 * A ticket's screen is shown only the answer to the member's last message: a
 * draft written before anybody spoke again answers a conversation that has
 * moved on. Setting a draft aside or using it changes only one still waiting,
 * so the record of what was sent is never rewritten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const session = { user: { id: "agent", role: "staff" } as { id: string; role: string } | undefined };
const held = new Set<string>();
let lastAuthor: "member" | "staff" = "member";
let waiting: { id: string; status: string; afterMessageId: string }[] = [];

vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => (session.user ? session : null)) }));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown) => {
        if (hook === "tickets.thread.read") {
            return { id: "t1", messages: [{ id: "m-1", author: "member" }, ...(lastAuthor === "staff" ? [{ id: "s-1", author: "staff" }] : [])] };
        }
        if (hook === "tickets.priorities.list") return [{ id: "HIGH", label: "High" }];
        return value;
    }),
}));
vi.mock("@/core/sdk/server", () => ({
    hasPermission: vi.fn(async (_user: string, permission: string) => held.has(permission)),
    rateLimitForRoleAsync: vi.fn(async () => true),
    readJsonBody: async (request: Request) => request.json(),
    enumParam: (params: URLSearchParams, name: string, allowed: string[]) => {
        const raw = params.get(name);
        return raw && allowed.includes(raw) ? raw : null;
    },
    pageParams: () => ({ page: 1, limit: 50, skip: 0, take: 50 }),
    prisma: {
        aiSupportDraft: {
            findFirst: vi.fn(async ({ where }: { where: { afterMessageId: string; status: { in: string[] } } }) =>
                waiting.find((d) => d.afterMessageId === where.afterMessageId && where.status.in.includes(d.status))
                    ? { id: "d1", status: "draft", reply: "Try relogging.", priority: "HIGH", departmentId: null }
                    : null),
            findMany: vi.fn(async () => []),
            count: vi.fn(async () => 0),
            updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: { status: string } }) => {
                const draft = waiting.find((d) => d.id === where.id && where.status.in.includes(d.status));
                if (!draft) return { count: 0 };
                draft.status = data.status;
                return { count: 1 };
            }),
        },
    },
}));

const draftRoute = await import("@/modules/ai-support/api/tickets/[ticketId]/draft/route");
const oneDraft = await import("@/modules/ai-support/api/admin/drafts/[id]/route");
const list = await import("@/modules/ai-support/api/admin/drafts/route");

const readDraft = () => draftRoute.GET(new NextRequest("http://site.test/x?locale=en"), { params: Promise.resolve({ ticketId: "t1" }) });
const mark = (id: string, status: string) =>
    oneDraft.PATCH(new NextRequest("http://site.test/x", { method: "PATCH", body: JSON.stringify({ status }) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
    session.user = { id: "agent", role: "staff" };
    held.clear();
    held.add("ai-support.use");
    lastAuthor = "member";
    waiting = [{ id: "d1", status: "draft", afterMessageId: "m-1" }];
});

describe("a ticket's draft", () => {
    it("is shown to whoever answers tickets, with its suggestion named", async () => {
        const res = await readDraft();
        expect(res.status).toBe(200);
        expect((await res.json()).draft).toMatchObject({ id: "d1", reply: "Try relogging.", priorityLabel: "High" });
    });

    it("is not shown once somebody has spoken after the message it answers", async () => {
        lastAuthor = "staff";
        expect((await (await readDraft()).json()).draft).toBeNull();
    });

    it("is nobody else's", async () => {
        held.clear();
        expect((await readDraft()).status).toBe(403);
        session.user = undefined;
        expect((await readDraft()).status).toBe(401);
    });
});

describe("what becomes of a draft", () => {
    it("is recorded while it waits", async () => {
        expect((await mark("d1", "used")).status).toBe(200);
        expect(waiting[0].status).toBe("used");
    });

    it("cannot be rewritten once it was sent", async () => {
        waiting[0].status = "sent";
        expect((await mark("d1", "discarded")).status).toBe(409);
        expect(waiting[0].status).toBe("sent");
    });

    it("cannot be marked anything but used or set aside", async () => {
        expect((await mark("d1", "sent")).status).toBe(400);
    });
});

describe("the record", () => {
    it("is for the assistant's managers, not for everyone who answers tickets", async () => {
        expect((await list.GET(new NextRequest("http://site.test/x"))).status).toBe(403);
        held.add("ai-support.manage");
        expect((await list.GET(new NextRequest("http://site.test/x"))).status).toBe(200);
    });
});
