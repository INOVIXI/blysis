import { applyFiltersAsync } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

/**
 * Everything this site can export, asked of whatever is installed.
 *
 * The members are core's own table and are always here. Anything else - a
 * shop's products, its orders - belongs to the module that owns the rows, and
 * that module answers.
 */

/** The members. Named columns: nothing here wants a password hash in a file. */
const members: CsvExport = {
    id: "users",
    labelKey: "csvImportExport.adm_exportUsers",
    header: ["id", "username", "email", "role", "isBanned", "creditBalance", "createdAt"],
    read: async (skip, take) => {
        const rows = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                isBanned: true,
                creditBalance: true,
                createdAt: true,
                role: { select: { name: true } },
            },
            // Paging without an order is paging over an undefined sequence:
            // the database may hand back a row twice and never hand back
            // another.
            orderBy: { id: "asc" },
            skip,
            take,
        });
        return rows.map((user) => [
            user.id,
            user.username,
            user.email,
            user.role?.name ?? "",
            user.isBanned,
            // A Prisma Decimal is an object; as a number it is written as a
            // figure rather than quoted as a word.
            Number(user.creditBalance),
            user.createdAt,
        ]);
    },
};

export async function listExports(): Promise<CsvExport[]> {
    return applyFiltersAsync("csv.exports", [members]);
}

export async function findExport(id: string): Promise<CsvExport | null> {
    return (await listExports()).find((one) => one.id === id) ?? null;
}
