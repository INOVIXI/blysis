import { getActiveTheme } from "@/core/lib/theme-state";
import { WidgetSettingsScreen } from "./WidgetSettingsScreen";

/**
 * Whether the active theme arranges the homepage itself is in its manifest,
 * which is read on the server; the screen says so when it does.
 */
export default async function WidgetSettingsPage() {
    const { manifest } = await getActiveTheme();
    return <WidgetSettingsScreen arrangedBy={manifest.layouts?.home ? manifest.name : null} />;
}
