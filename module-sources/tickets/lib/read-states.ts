import { prisma } from "@/core/sdk/server";
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, type TicketState } from "./ticket-states";

/**
 * The states this desk has, seeded on first read.
 *
 * Seeded rather than enforced: an operator may rename one, re-tone it, or
 * take it away, which is what moving them out of two Prisma enums was for.
 * The nine this module ships carry a `nameKey`, so they stay translated
 * whatever else is added beside them.
 */
export async function ensureStatesSeeded(): Promise<void> {
    const [statuses, priorities] = await Promise.all([
        prisma.ticketStatus.count(),
        prisma.ticketPriority.count(),
    ]);
    if (statuses === 0) {
        await prisma.ticketStatus.createMany({
            data: DEFAULT_STATUSES.map((state) => ({ ...state })),
            skipDuplicates: true,
        });
    }
    if (priorities === 0) {
        await prisma.ticketPriority.createMany({
            data: DEFAULT_PRIORITIES.map((state) => ({ ...state })),
            skipDuplicates: true,
        });
    }
}

export interface TicketStateRow extends TicketState {
    id: string;
    order: number;
    isActive: boolean;
}

/** Every state a screen may draw or offer, in the order an operator set. */
export async function readTicketStates(): Promise<{
    statuses: TicketStateRow[];
    priorities: TicketStateRow[];
}> {
    await ensureStatesSeeded();
    const [statuses, priorities] = await Promise.all([
        prisma.ticketStatus.findMany({
            where: { isActive: true },
            orderBy: [{ order: "asc" }, { key: "asc" }],
            select: {
                id: true, key: true, name: true, nameKey: true, tone: true,
                isOpen: true, closesTicket: true, order: true, isActive: true,
            },
        }),
        prisma.ticketPriority.findMany({
            where: { isActive: true },
            orderBy: [{ order: "asc" }, { key: "asc" }],
            select: { id: true, key: true, name: true, nameKey: true, tone: true, order: true, isActive: true },
        }),
    ]);
    return { statuses, priorities };
}
