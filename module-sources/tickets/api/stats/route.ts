import { NextRequest, NextResponse } from "next/server";
import { readTicketStates } from "../../lib/read-states";
import { openStatusKeys } from "../../lib/ticket-states";
import { dailySeries, dayLabels, hasPermission, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * The dashboard and analytics screens are the only callers, and both are
 * behind the admin panel. Without this the endpoint answered anyone: an
 * anonymous request read the numbers straight out of the database.
 */
async function requireAdmin(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "tickets.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return null;
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const period = Math.min(
        365,
        Math.max(1, parseInt(request.nextUrl.searchParams.get("period") || "30", 10) || 30),
    );

    const tickets = await prisma.ticket.count();
    /*
     * Which states count as open is the operator's now, so it is asked
     * rather than named. Three status names were written into this query,
     * and a desk that renamed any of them got a dashboard counting nothing.
     */
    const { statuses } = await readTicketStates();
    const openTickets = await prisma.ticket.findMany({
        take: 5,
        where: { status: { in: openStatusKeys(statuses) } },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { username: true } }, department: { select: { name: true } } },
    });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    startDate.setHours(0, 0, 0, 0);

    // Grouped by the database. This used to read every row in the window and
    // bucket it here, so the work grew with the site's history to produce one
    // number per day.
    const series = await dailySeries({ table: "Ticket", since: startDate });

    /*
     * The word, not the column, and said where the reader's language is
     * known. This route has no locale of its own, so it sends the key the
     * panel already holds and a readable fallback for a state an operator
     * added, which has a typed name and no key.
     */
    const badgeFor = (key: string) => {
        const state = statuses.find((one) => one.key === key);
        return {
            text: state?.name ?? key.replace(/_/g, " "),
            key: state?.nameKey ? `tickets.${state.nameKey}` : undefined,
        };
    };

    const labels = dayLabels(startDate, period);
    const byDay: Record<string, number> = Object.fromEntries(labels.map((k) => [k, 0]));
    for (const row of series) {
        if (row.day in byDay) byDay[row.day] = row.count;
    }

    return NextResponse.json({
        stats: { tickets },
        charts: [
            {
                id: "tickets-opened",
                label: "Tickets opened per day",
                labelKey: "analytics_ticketsPerDay",
                labels,
                data: labels.map((k) => byDay[k]),
                color: "#ef4444",
            },
        ],
        sections: [{
            id: "open-tickets",
            title: "Open Tickets",
            titleKey: "dashboard_openTickets",
            viewAllHref: "/admin/tickets",
            items: openTickets.map(t => ({
                id: t.id,
                href: "/admin/tickets/" + t.id,
                primary: t.subject,
                secondary: [t.user?.username, t.department?.name].filter(Boolean).join(" · "),
                /*
                 * The word, not the column. This sent `t.status` and the
                 * dashboard drew it, so the first screen an operator opens
                 * said WAITING_REPLY in English capitals whatever language
                 * the panel was in.
                 */
                badge: badgeFor(t.status).text,
                badgeKey: badgeFor(t.status).key,
                badgeColor: "blue",
            }))
        }]
    });
}
