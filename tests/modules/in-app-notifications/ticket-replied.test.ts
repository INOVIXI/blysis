// @vitest-environment node
/**
 * The member who opened a ticket hears about an answer to it.
 *
 * An answer is staff's or a support assistant's, and the notification says
 * which: the assistant's is never announced as the team's. The member's own
 * reply is not news to them. Either way the link opens the ticket where a
 * member reads it, which is under /support: /tickets/<id> is no page at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const created: Record<string, unknown>[] = [];
let wantsIt = true;

vi.mock("@/core/sdk/server", () => ({
    shouldNotify: async (_user: string, event: string, channel: string) =>
        wantsIt && event === "tickets.ticket.replied" && channel === "inapp",
}));
vi.mock("@/modules/in-app-notifications/lib/notifications", () => ({
    createNotification: async (params: Record<string, unknown>) => {
        created.push(params);
    },
}));

const onReplied = (await import("@/modules/in-app-notifications/listeners/ticket-replied")).default;

const ticket = { id: "t1", subject: "Rank missing", userId: "m1" };

beforeEach(() => {
    created.length = 0;
    wantsIt = true;
});

describe("an answer to a ticket", () => {
    it("from staff tells the member, with a link to the ticket's page", async () => {
        await onReplied({ ticket, isStaffReply: true });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ userId: "m1", titleKey: "notif_ticketRepliedTitle", href: "/support/t1" });
    });

    it("from the assistant says it was the assistant", async () => {
        await onReplied({ ticket, isStaffReply: false, byAssistant: true });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            userId: "m1",
            titleKey: "notif_ticketAssistantTitle",
            messageKey: "notif_ticketAssistantMessage",
            href: "/support/t1",
        });
    });

    it("from the member themselves is not news", async () => {
        await onReplied({ ticket, isStaffReply: false });
        expect(created).toHaveLength(0);
    });

    it("reaches nobody who switched it off, or whose account is gone", async () => {
        wantsIt = false;
        await onReplied({ ticket, isStaffReply: true });
        wantsIt = true;
        await onReplied({ ticket: { ...ticket, userId: null }, isStaffReply: true });
        expect(created).toHaveLength(0);
    });
});
