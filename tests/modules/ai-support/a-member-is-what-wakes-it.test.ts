// @vitest-environment node
/**
 * What puts a ticket in front of the support assistant.
 *
 * A ticket opened, or a member writing on one, asks for an answer. Staff
 * writing means a person is on it, so a waiting answer is let go. The
 * assistant's own message asks for nothing: answering it would have the
 * assistant talking to itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueue = vi.fn(async (_ticketId: string) => undefined);
const forget = vi.fn(async (_ticketId: string) => undefined);

vi.mock("@/modules/ai-support/lib/round", () => ({ enqueue, forget }));

const onOpened = (await import("@/modules/ai-support/listeners/ticket-opened")).default;
const onReplied = (await import("@/modules/ai-support/listeners/ticket-replied")).default;

const ticket = { id: "t1", subject: "Rank", userId: "m1", priority: "LOW" };
const message = { id: "x", content: "hi" };

beforeEach(() => vi.clearAllMocks());

describe("what wakes the assistant", () => {
    it("is a ticket being opened", async () => {
        await onOpened(ticket);
        expect(enqueue).toHaveBeenCalledWith("t1");
    });

    it("is a member writing", async () => {
        await onReplied({ ticket, message, isStaffReply: false });
        expect(enqueue).toHaveBeenCalledWith("t1");
        expect(forget).not.toHaveBeenCalled();
    });

    it("is never its own message", async () => {
        await onReplied({ ticket, message, isStaffReply: false, byAssistant: true });
        expect(enqueue).not.toHaveBeenCalled();
        expect(forget).not.toHaveBeenCalled();
    });

    it("stops at staff writing, who are on it now", async () => {
        await onReplied({ ticket, message, isStaffReply: true });
        expect(forget).toHaveBeenCalledWith("t1");
        expect(enqueue).not.toHaveBeenCalled();
    });
});
