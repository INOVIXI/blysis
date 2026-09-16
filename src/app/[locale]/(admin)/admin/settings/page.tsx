import { redirect } from "@/core/lib/i18n/navigation";
import { getLocale } from "next-intl/server";

/**
 * `/admin/settings` is a group, not a page.
 *
 * The screen was split into sections - general, site, navbar, footer and the
 * rest - and the group's own path was left with nothing behind it. The
 * sidebar only ever links to a section, so nothing in the panel pointed here
 * and the 404 stayed invisible; an operator typing the address they remember,
 * or following a bookmark from before the split, met it.
 *
 * General is the first section and the one the sidebar opens.
 */
export default async function SettingsIndex() {
    redirect({ href: "/admin/settings/general", locale: await getLocale() });
}
