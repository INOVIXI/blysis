// @vitest-environment node
/**
 * A department's name and description and the name of a state an operator
 * added, written once per language, are read in the reader's. What a member
 * and the staff write to each other is theirs and is never translated.
 *
 * The columns keep what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The ticket screens
 * ask with `?locale=`, and a language with no translation reads the
 * original. A state this module ships is named by its translation key, as
 * before, whatever a stray translation row says.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };
const staff: { value: boolean } = { value: true };

const ticketDepartment = fakeTable(() => ({ description: null, color: null, order: 0, isActive: true }));
const ticketDepartmentField = fakeTable();
const ticketDepartmentPermission = fakeTable();
const ticketStatus = fakeTable(() => ({ name: null, nameKey: null, tone: "neutral", isOpen: true, closesTicket: false, order: 0, isActive: true }));
const ticketPriority = fakeTable(() => ({ name: null, nameKey: null, tone: "neutral", order: 0, isActive: true }));
const ticket = fakeTable(() => ({ status: "OPEN", priority: "MEDIUM", userId: "member", updatedAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);

// The in-memory tables know no relations, so a ticket is read with its
// department the way Prisma would join it.
const ticketRows = ticket.findMany.getMockImplementation()!;
ticket.findMany.mockImplementation(async (args = {}) => (await ticketRows(args)).map((row) => {
    const department = ticketDepartment.table.rows.find((d) => d.id === row.departmentId)!;
    return { ...row, department: { id: department.id, name: department.name, color: department.color }, user: null, assignedTo: null, _count: { messages: 0 } };
}));

const departmentRow = ticketDepartment.findUnique.getMockImplementation()!;
ticketDepartment.findUnique.mockImplementation(async (args) => {
    const row = await departmentRow(args);
    return row ? { ...row, _count: { tickets: ticket.table.rows.filter((t) => t.departmentId === row.id).length } } : null;
});

const db: Record<string, unknown> = {
    ticketDepartment, ticketDepartmentField, ticketDepartmentPermission, ticketStatus, ticketPriority, ticket, contentTranslation,
    activityLog: { create: async () => ({}) },
};
db.$transaction = fakeTransaction(db, [ticketDepartment.table, ticketStatus.table, ticketPriority.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        hasPermission: async () => staff.value,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
        isRestrictedFrom: async () => false,
        rateLimitForRole: () => ({ allowed: true }),
        pageParams: (await vi.importActual<typeof import("@/core/lib/page-params")>("@/core/lib/page-params")).pageParams,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: staff.value ? "admin" : "member", role: null } }) }));

const departments = () => import("@/modules/tickets/api/tickets/departments/route");
const department = () => import("@/modules/tickets/api/tickets/departments/[id]/route");
const states = () => import("@/modules/tickets/api/tickets/states/route");
const tickets = () => import("@/modules/tickets/api/tickets/route");

async function send<T>(handler: (r: never) => Promise<Response>, payload: Record<string, unknown>) {
    body.value = payload;
    const res = await handler(new Request("https://example.com", { method: "POST" }) as never);
    return { status: res.status, json: (await res.json()) as T };
}

/** What a member's ticket list is drawn from: their tickets, and the words for their states. */
async function memberList(lang: string) {
    staff.value = false;
    const { GET } = await tickets();
    const res = await GET(new Request(`https://example.com/api/v1/tickets?locale=${lang}`) as never);
    staff.value = true;
    return (await res.json()) as {
        tickets: { department: { name: string } }[];
        states: { statuses: { key: string; name: string | null; nameKey: string | null }[] };
    };
}

async function memberDepartments(lang: string) {
    staff.value = false;
    const { GET } = await departments();
    const res = await GET(new Request(`https://example.com/api/v1/tickets/departments?locale=${lang}`) as never);
    staff.value = true;
    return (await res.json()).departments as { name: string; description: string | null }[];
}

async function seed() {
    // The desk's screen is where its shipped states are first written.
    await (await states()).GET();
    const made = await send<{ id: string }>((await departments()).POST, {
        name: "Ödemeler", description: "Satın alma sorunları",
        translations: { name: { en: "Payments" }, description: { en: "Problems with a purchase", de: "Probleme mit einem Kauf" } },
    });
    expect(made.status).toBe(201);
    const state = await send<{ state: { id: string } }>((await states()).POST, {
        kind: "status", key: "WITH_DEV", name: "Geliştiricide", tone: "info",
        translations: { name: { en: "With the developers" } },
    });
    expect(state.status).toBe(201);
    ticket.table.rows.push({ id: "t1", subject: "Param gitti", departmentId: made.json.id, status: "WITH_DEV", priority: "MEDIUM", userId: "member", updatedAt: new Date() });
    return { departmentId: made.json.id, stateId: state.json.state.id };
}

beforeEach(() => {
    for (const table of [ticketDepartment, ticketStatus, ticketPriority, ticket, contentTranslation]) table.table.rows = [];
    staff.value = true;
});

describe("a support desk written in three languages", () => {
    it("offers a member its departments in their language, and the original where theirs is missing", async () => {
        await seed();
        expect(await memberDepartments("tr")).toMatchObject([{ name: "Ödemeler", description: "Satın alma sorunları" }]);
        expect(await memberDepartments("en")).toMatchObject([{ name: "Payments", description: "Problems with a purchase" }]);
        expect(await memberDepartments("de")).toMatchObject([{ name: "Ödemeler", description: "Probleme mit einem Kauf" }]);
        expect(ticketDepartment.table.rows[0]).toMatchObject({ name: "Ödemeler" });
    });

    it("names a ticket's department and the operator's states in the member's language, and leaves the subject alone", async () => {
        await seed();
        const en = await memberList("en");
        expect(en.tickets).toMatchObject([{ subject: "Param gitti", department: { name: "Payments" } }]);
        expect(en.states.statuses.find((s) => s.key === "WITH_DEV")).toMatchObject({ name: "With the developers" });
        const fr = await memberList("fr");
        expect(fr.tickets).toMatchObject([{ department: { name: "Ödemeler" } }]);
        expect(fr.states.statuses.find((s) => s.key === "WITH_DEV")).toMatchObject({ name: "Geliştiricide" });
        // A shipped state still carries the key the catalogue translates.
        expect(en.states.statuses.find((s) => s.key === "OPEN")).toMatchObject({ name: null, nameKey: "open" });
    });

    it("is handed to the editors with every language, edited language by language, and takes them when deleted", async () => {
        const { departmentId, stateId } = await seed();
        const admin = await (await (await departments()).GET(new Request("https://example.com/api/v1/tickets/departments") as never)).json();
        expect(admin.departments).toEqual([expect.objectContaining({ translations: expect.objectContaining({ name: { en: "Payments" } }) })]);
        const desk = await (await (await states()).GET()).json();
        expect(desk.statuses.find((s: { id: string }) => s.id === stateId)).toMatchObject({ translations: { name: { en: "With the developers" } } });

        const { PATCH, DELETE } = await department();
        body.value = { name: "Satın alma", translations: { name: { de: "Käufe" } } };
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, { params: Promise.resolve({ id: departmentId }) })).status).toBe(200);
        expect(await memberDepartments("en")).toMatchObject([{ name: "Satın alma", description: "Problems with a purchase" }]);
        expect(await memberDepartments("de")).toMatchObject([{ name: "Käufe" }]);

        expect((await send((await states()).PATCH, { kind: "status", id: stateId, name: "Geliştiricide", translations: { name: {} } })).status).toBe(200);
        expect((await memberList("en")).states.statuses.find((s) => s.key === "WITH_DEV")).toMatchObject({ name: "Geliştiricide" });

        await send((await states()).DELETE, { kind: "status", id: stateId });
        ticket.table.rows = [];
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, { params: Promise.resolve({ id: departmentId }) });
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await send((await states()).POST, { kind: "priority", key: "P1", name: "Acil", tone: "danger", translations: { name: { en: "x".repeat(65) } } });
        expect(status).toBe(400);
        expect(ticketPriority.table.rows.filter((row) => row.key === "P1")).toHaveLength(0);
    });
});
