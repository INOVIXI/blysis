/**
 * Blysis module SDK - active theme configuration.
 *
 * Its own entry point because `useThemeConfig` is a React context hook: it can
 * only be called from a client component, and folding it into the isomorphic
 * barrel would make that barrel client-only for every server file importing
 * `formatDate`.
 */
export { useThemeConfig } from "@/core/lib/theme-config-client";

/**
 * Renders a theme's override for a named component, falling back to core's
 * own. Lives here rather than in `/layout` because it is theme integration,
 * not page composition.
 */
export { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";

/**
 * What a theme's own frame is drawn from. A theme names `SiteShell`,
 * `PageHeader` or `AuthFrame` in its manifest's `components` to replace one,
 * and is handed the props typed here.
 */
export type { SiteShellProps } from "@/core/components/layout/SiteShell";
export type { PageHeaderProps } from "@/core/components/layout/PageHeader";
export type { AuthFrameProps } from "@/core/components/layout/AuthFrame";

/** The site's navigation as the bar sees it, for a theme that draws its own. */
export { useNavLinks } from "@/core/hooks/useNavLinks";
export type { NavLink, NavLinks } from "@/core/hooks/useNavLinks";

/** The controls at the end of the bar, wherever a theme puts them. */
export { NavbarActions } from "@/core/components/layout/NavbarActions";

export { PageBreadcrumb } from "@/core/components/layout/PageBreadcrumb";
export type { Crumb } from "@/core/components/layout/PageBreadcrumb";
export { SiteName, SiteMark } from "@/core/components/ui/site-name";
