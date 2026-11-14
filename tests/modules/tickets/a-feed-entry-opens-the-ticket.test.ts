// @vitest-environment node
/**
 * The private feed entry a reply leaves links to the ticket's page.
 *
 * It linked to /tickets/<id>, which is no page: a member reads a ticket under
 * /support, and staff can open it there too. Opening a ticket left the same
 * dead link and is fixed with it.
 *
 * The reply is the text alone, which is what a member's screen sends. The
 * route used to want the ticket's id in the body as well as in the address,
 * and refused every reply a member wrote with a 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const feed: Record<string, unknown>[] = [];
const doActionAsync = vi.fn(async (_hook: string, _payload: unknown) => undefined);

vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "m1", role: "member" } })) }));
vi.mock("@/core/sdk/server", () => ({
    hasPermission: vi.fn(async () => false),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    rateLimitForRoleAsync: vi.fn(async () => true),
    readJsonBody: async (request: Request) => request.json(),
    prisma: {
        ticket: {
            findUnique: vi.fn(async () => ({ id: "t1", subject: "Rank", status: "OPEN", userId: "m1", priority: "LOW" })),
            update: vi.fn(async () => ({})),
        },
        ticketMessage: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "msg1", ...data, user: null })),
        },
        activityFeedItem: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                feed.push(data);
                return data;
            }),
        },
    },
}));
vi.mock("@/core/sdk", () => ({ doActionAsync }));
vi.mock("@/modules/tickets/lib/can-access-ticket", () => ({ canAccessTicket: vi.fn(async () => true) }));
vi.mock("@/modules/tickets/lib/read-states", () => ({
    readTicketStates: vi.fn(async () => ({
        statuses: [{ key: "OPEN", isOpen: true, closesTicket: false }],
        priorities: [],
    })),
}));

const { POST } = await import("@/modules/tickets/api/tickets/[id]/route");

beforeEach(() => {
    feed.length = 0;
    vi.clearAllMocks();
});

describe("a member's reply", () => {
    it("leaves a feed entry that opens the ticket's page", async () => {
        const res = await POST(
            new NextRequest("http://site.test/api/v1/tickets/t1", { method: "POST", body: JSON.stringify({ content: "Still missing" }) }),
            { params: Promise.resolve({ id: "t1" }) },
        );
        expect(res.status).toBe(201);
        expect(feed).toHaveLength(1);
        expect(feed[0].href).toBe("/support/t1");
    });

    it("is announced as the member's, not the team's or an assistant's", async () => {
        await POST(
            new NextRequest("http://site.test/api/v1/tickets/t1", { method: "POST", body: JSON.stringify({ content: "Still missing" }) }),
            { params: Promise.resolve({ id: "t1" }) },
        );
        const [, payload] = doActionAsync.mock.calls.find(([hook]) => hook === "tickets.ticket.replied") ?? [];
        expect(payload).toMatchObject({ isStaffReply: false });
        expect((payload as { byAssistant?: boolean }).byAssistant).toBeFalsy();
    });
});
