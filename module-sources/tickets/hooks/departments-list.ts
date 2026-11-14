/** Answers `tickets.departments.list`: the departments a ticket may be in, named in `locale`. */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma, translateContent } from "@/core/sdk/server";
import { DEPARTMENT_TEXT } from "../lib/desk-text";

const departmentsList: HookHandlerFor<"tickets.departments.list", "filter"> = async (_current, { locale }) => {
    const rows = await prisma.ticketDepartment.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
    });
    const named = await translateContent(prisma, DEPARTMENT_TEXT, rows, ["name"], locale);
    return named.map((row) => ({ id: row.id, label: row.name }));
};

export default departmentsList;
