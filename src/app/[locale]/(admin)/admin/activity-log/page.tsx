import { redirect } from "@/core/lib/i18n/navigation";
import { getLocale } from "next-intl/server";

/**
 * There was one record and two screens reading it.
 *
 * `/admin/activity-log` and `/admin/audit-log` both listed the `ActivityLog`
 * table, side by side in the sidebar with the same icon, and an operator had
 * to learn which was which by opening both. They were not two views of one
 * thing either: the audit log filters by action, by person and by date,
 * expands the metadata and exports what it shows, and this one had four
 * columns and no filter at all.
 *
 * So there is one screen. This path stays because somebody has it bookmarked
 * and a 404 is a worse answer than the screen they were looking for.
 */
export default async function ActivityLogMovedToAuditLog() {
    redirect({ href: "/admin/audit-log", locale: await getLocale() });
}
