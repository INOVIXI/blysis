// @vitest-environment node
/**
 * What another module may do to a ticket on an assistant's behalf.
 *
 * An assistant reads the conversation and may add one message to it, and
 * nothing else. The message is marked as the assistant's, never as staff's,
 * and it is refused on a ticket that is finished, on one where somebody asked
 * for a person, and on one where anybody spoke after the message it answers.
 * The member who opened the ticket may stop the assistant and ask for a
 * person; only the support team may let it speak again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row { id: string; [key: string]: unknown }

const db = {
    tickets: [] as Row[],
    messages: [] as Row[],
    departments: [] as Row[],
    statuses: [] as Row[],
    priorities: [] as Row[],
    users: [] as Row[],
};

let seq = 0;
const match = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

const table = (rows: () => Row[]) => ({
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows().find((r) => match(r, where)) ?? null),
    findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const found = rows().filter((r) => match(r, where));
        return found[found.length - 1] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows().filter((r) => match(r, where))),
    count: vi.fn(async () => rows().length),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${++seq}`, createdAt: new Date(Date.now() + seq), ...data } as Row;
        rows().push(row);
        return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows().find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
    }),
});

const prisma = {
    ticket: table(() => db.tickets),
    ticketMessage: table(() => db.messages),
    ticketDepartment: table(() => db.departments),
    ticketStatus: table(() => db.statuses),
    ticketPriority: table(() => db.priorities),
    user: table(() => db.users),
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
};

const staff = new Set<string>();
const doActionAsync = vi.fn(async (_hook: string, _payload: unknown) => undefined);

vi.mock("@/core/sdk/server", () => ({
    prisma,
    hasPermission: vi.fn(async (userId: string, permission: string) => permission === "tickets.manage" && staff.has(userId)),
    translateContent: async (_p: unknown, _o: unknown, rows: unknown[]) => rows,
    moduleTranslator: async () => (key: string) => `t:${key}`,
}));
vi.mock("@/core/sdk", () => ({ doActionAsync }));

const { readThread, postAssistantReply, classifyTicket, setAssistantPaused } = await import("@/modules/tickets/lib/assistant");

beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
    staff.clear();
    staff.add("agent");
    db.users = [{ id: "owner", locale: "tr" }, { id: "agent", locale: "en" }];
    db.departments = [
        { id: "d1", name: "Billing", isActive: true },
        { id: "d2", name: "Technical", isActive: true },
        { id: "d3", name: "Old", isActive: false },
    ];
    db.statuses = [
        { id: "s1", key: "OPEN", isOpen: true, closesTicket: false, isActive: true, order: 0 },
        { id: "s2", key: "CLOSED", isOpen: false, closesTicket: true, isActive: true, order: 1 },
    ];
    db.priorities = [
        { id: "p1", key: "LOW", nameKey: "priority_low", name: null, isActive: true, order: 0 },
        { id: "p2", key: "HIGH", nameKey: null, name: "Burning", isActive: true, order: 1 },
    ];
    db.tickets = [{
        id: "t1", subject: "Refund?", status: "OPEN", priority: "LOW", departmentId: "d1",
        userId: "owner", assistantPaused: false, askedForPersonAt: null, createdAt: new Date(0),
    }];
    db.messages = [
        { id: "a", ticketId: "t1", content: "Where is my rank?", isStaffReply: false, byAssistant: false, userId: "owner", createdAt: new Date(1) },
    ];
});

describe("reading the conversation", () => {
    it("names who said each thing, and the member's language", async () => {
        db.messages.push(
            { id: "b", ticketId: "t1", content: "Try relogging", isStaffReply: false, byAssistant: true, userId: null, createdAt: new Date(2) },
            { id: "c", ticketId: "t1", content: "Looking", isStaffReply: true, byAssistant: false, userId: "agent", createdAt: new Date(3) },
        );
        const thread = await readThread("t1");
        expect(thread).toMatchObject({
            id: "t1", subject: "Refund?", isOpen: true, departmentId: "d1", departmentName: "Billing",
            memberLocale: "tr", assistantPaused: false,
        });
        expect(thread?.messages.map((m) => [m.id, m.author])).toEqual([["a", "member"], ["b", "assistant"], ["c", "staff"]]);
    });

    it("is nothing for a ticket that is not there", async () => {
        expect(await readThread("nope")).toBeNull();
    });
});

describe("an assistant's reply", () => {
    it("is written as the assistant's, never as staff's, and announced as such", async () => {
        const outcome = await postAssistantReply({ ticketId: "t1", content: "  Your rank is on its way.  ", afterMessageId: "a" });
        expect(outcome.ok).toBe(true);
        const written = db.messages[db.messages.length - 1];
        expect(written).toMatchObject({ content: "Your rank is on its way.", byAssistant: true, isStaffReply: false, userId: null });
        expect(doActionAsync).toHaveBeenCalledWith("tickets.ticket.replied", expect.objectContaining({ isStaffReply: false, byAssistant: true }));
    });

    it("leaves the ticket's state where it was", async () => {
        await postAssistantReply({ ticketId: "t1", content: "Hello", afterMessageId: "a" });
        expect(db.tickets[0].status).toBe("OPEN");
    });

    it("is refused once somebody has spoken after the message it answers", async () => {
        db.messages.push({ id: "b", ticketId: "t1", content: "On it", isStaffReply: true, byAssistant: false, userId: "agent", createdAt: new Date(2) });
        expect(await postAssistantReply({ ticketId: "t1", content: "Hello", afterMessageId: "a" })).toEqual({ ok: false, reason: "stale" });
    });

    it("is refused on a finished ticket", async () => {
        db.tickets[0].status = "CLOSED";
        expect(await postAssistantReply({ ticketId: "t1", content: "Hello", afterMessageId: "a" })).toEqual({ ok: false, reason: "closed" });
    });

    it("is refused where the assistant was stopped", async () => {
        db.tickets[0].assistantPaused = true;
        expect(await postAssistantReply({ ticketId: "t1", content: "Hello", afterMessageId: "a" })).toEqual({ ok: false, reason: "paused" });
    });

    it("is refused when it says nothing, or the ticket is gone", async () => {
        expect(await postAssistantReply({ ticketId: "t1", content: "   ", afterMessageId: "a" })).toEqual({ ok: false, reason: "empty" });
        expect(await postAssistantReply({ ticketId: "x", content: "Hi", afterMessageId: "a" })).toEqual({ ok: false, reason: "not_found" });
        expect(doActionAsync).not.toHaveBeenCalled();
    });
});

describe("sorting a ticket", () => {
    it("moves it to a department and priority the desk has", async () => {
        expect(await classifyTicket({ ticketId: "t1", departmentId: "d2", priority: "HIGH" })).toEqual({ changed: ["department", "priority"] });
        expect(db.tickets[0]).toMatchObject({ departmentId: "d2", priority: "HIGH" });
        expect(doActionAsync).toHaveBeenCalledWith("tickets.ticket.updated", expect.anything());
    });

    it("ignores a department or priority the desk does not have, or has switched off", async () => {
        expect(await classifyTicket({ ticketId: "t1", departmentId: "d3", priority: "URGENT" })).toEqual({ changed: [] });
        expect(await classifyTicket({ ticketId: "t1", departmentId: "nope" })).toEqual({ changed: [] });
        expect(db.tickets[0]).toMatchObject({ departmentId: "d1", priority: "LOW" });
        expect(doActionAsync).not.toHaveBeenCalled();
    });

    it("leaves a finished ticket alone", async () => {
        db.tickets[0].status = "CLOSED";
        expect(await classifyTicket({ ticketId: "t1", priority: "HIGH" })).toEqual({ changed: [] });
    });
});

describe("stopping the assistant", () => {
    it("lets the member ask for a person, which the team hears about", async () => {
        expect(await setAssistantPaused("t1", "owner", true)).toBe("ok");
        expect(db.tickets[0].assistantPaused).toBe(true);
        expect(db.tickets[0].askedForPersonAt).toBeInstanceOf(Date);
        expect(doActionAsync).toHaveBeenCalledWith("tickets.ticket.handedOff", expect.objectContaining({ id: "t1" }));
    });

    it("does not let the member switch it back on", async () => {
        db.tickets[0].assistantPaused = true;
        expect(await setAssistantPaused("t1", "owner", false)).toBe("not_allowed");
        expect(db.tickets[0].assistantPaused).toBe(true);
    });

    it("lets the team stop it and start it again, which answers the member's request", async () => {
        expect(await setAssistantPaused("t1", "agent", true)).toBe("ok");
        expect(db.tickets[0].askedForPersonAt).toBeNull();
        db.tickets[0].askedForPersonAt = new Date();
        expect(await setAssistantPaused("t1", "agent", false)).toBe("ok");
        expect(db.tickets[0]).toMatchObject({ assistantPaused: false, askedForPersonAt: null });
        expect(doActionAsync).not.toHaveBeenCalledWith("tickets.ticket.handedOff", expect.anything());
    });

    it("answers anybody else as if the ticket were not there", async () => {
        db.users.push({ id: "stranger", locale: "en" });
        expect(await setAssistantPaused("t1", "stranger", true)).toBe("not_found");
        expect(await setAssistantPaused("nope", "agent", true)).toBe("not_found");
        expect(db.tickets[0].assistantPaused).toBe(false);
    });
});
