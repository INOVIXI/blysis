/**
 * The desk's own words in the reader's language.
 *
 * Whose translations these are, in core's table, and the fields that have
 * them, each language held to its column's own limit. Only what the operator
 * named is translated - a department and a state they added. A ticket's
 * subject and its messages are what a member and the staff wrote to each
 * other, in the language they wrote them in. A state this module ships is
 * named by its translation key, which `stateLabel` reads before the name.
 */
import { prisma, translateContent } from "@/core/sdk/server";

export const DEPARTMENT_TEXT = { owner: "tickets", entity: "department" };
export const DEPARTMENT_FIELDS = { name: 100, description: 500 };
export const STATUS_TEXT = { owner: "tickets", entity: "status" };
export const PRIORITY_TEXT = { owner: "tickets", entity: "priority" };
export const STATE_FIELDS = { name: 64 };

/** Tickets with their department named in `locale`, one query for the page. */
export async function withDepartmentNames<T extends { department: { id: string; name: string } | null }>(
    tickets: T[],
    locale: string,
): Promise<T[]> {
    const departments = new Map<string, { id: string; name: string }>();
    for (const ticket of tickets) if (ticket.department) departments.set(ticket.department.id, ticket.department);
    const named = await translateContent(prisma, DEPARTMENT_TEXT, [...departments.values()], ["name"], locale);
    const nameOf = new Map(named.map((department) => [department.id, department.name]));
    return tickets.map((ticket) => ticket.department
        ? { ...ticket, department: { ...ticket.department, name: nameOf.get(ticket.department.id) ?? ticket.department.name } }
        : ticket);
}
