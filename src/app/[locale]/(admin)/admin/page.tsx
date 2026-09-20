import { redirect } from "@/core/lib/i18n/navigation";
import { getSession } from "@/core/lib/auth";
import { canOpenAdminPage } from "@/core/lib/permissions";
import { getLocale, getTranslations } from "next-intl/server";
import {
    DashboardKpiRow,
    ModuleSections,
} from "./components/dashboard-client";
import UsersCountWidget from "@/core/components/admin/widgets/UsersCountWidget";
import ActivityFeedWidget from "@/core/components/admin/widgets/ActivityFeedWidget";
import HealthSnapshotWidget from "@/core/components/admin/widgets/HealthSnapshotWidget";
import RecentErrorsWidget from "@/core/components/admin/widgets/RecentErrorsWidget";
import EmailQueueStatusWidget from "@/core/components/admin/widgets/EmailQueueStatusWidget";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

/*
 * Admin dashboard - grouped into distinct visual sections so the grid
 * stays uniform and nothing orphans on its own row.
 *
 *   ┌─ Header ────────────────────────────────────────┐
 *   │ Title                                           │
 *   ├─ KPI row ───────────────────────────────────────┤
 *   │ [ Users ] [ Health ] [ Email ] [ Errors ]       │ <- core 1x1 cards
 *   │ + module-contributed stat cards (same row)      │
 *   ├─ Panels row ────────────────────────────────────┤
 *   │ [ Activity feed      ]                          │ <- 2-col panels
 *   ├─ Module sections ───────────────────────────────┤
 *   │ [ Open tickets       ] [ Latest orders ]        │ <- module-contributed
 *   │ [ Recent forum topics ... ]                     │
 *   └─────────────────────────────────────────────────┘
 *
 * There was a per-admin customizer here: a dialog of checkboxes and up/down
 * arrows writing an order into the Setting table. It was two rounds of bug
 * fixes deep and still did not convince, so it is gone. The dashboard shows
 * what core and the enabled modules contribute, in the order the manifests
 * declare, the same for every admin. A module adds a card or a panel by
 * declaring it; that is the knob, and it is the one that composes.
 */

/** Core KPI cards, in the order the row shows them. */
const KPI_WIDGETS: [string, () => React.ReactNode][] = [
    ["users-count", () => <UsersCountWidget key="users-count" />],
    ["health-snapshot", () => <HealthSnapshotWidget key="health-snapshot" />],
    ["email-queue-status", () => <EmailQueueStatusWidget key="email-queue-status" />],
    ["recent-errors", () => <RecentErrorsWidget key="recent-errors" />],
];

export default async function AdminDashboard() {
    const session = await getSession();
    const locale = await getLocale();
    if (!session?.user) redirect({ href: "/auth/login", locale });
    if (!(await canOpenAdminPage(session.user.id, `/${locale}/admin`))) redirect({ href: "/", locale });

    const t = await getTranslations("admin");

    // The core cards are rendered here, on the server, and handed to the row
    // as nodes; the row fetches the module cards itself and appends them.
    const kpiOrder = KPI_WIDGETS.map(([id]) => id);
    const coreSlots: Record<string, React.ReactNode> = {};
    for (const [id, render] of KPI_WIDGETS) coreSlots[id] = render();

    return (
        <div className="space-y-6">
            {/* Header */}
            <AdminPageHeader
                title={t("dashboard_title")}
                description={t("dashboard_welcomeBack", { name: session.user.name })}
            />

            {/* KPI row - core KPIs + module stat cards, uniform 1x1 grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <DashboardKpiRow order={kpiOrder} coreSlots={coreSlots} />
            </div>

            {/* Panel row - larger activity/engagement cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <ActivityFeedWidget />
            </div>

            {/* Module sections - 2-col panels contributed by modules */}
            <ModuleSections />
        </div>
    );
}
