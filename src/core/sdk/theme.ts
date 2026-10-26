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
export type { NotFoundProps } from "@/core/components/layout/NotFoundContent";
export type { AuthFrameProps } from "@/core/components/layout/AuthFrame";

/** The site's navigation as the bar sees it, for a theme that draws its own. */
export { useNavLinks } from "@/core/hooks/useNavLinks";
export type { NavLink, NavLinks } from "@/core/hooks/useNavLinks";

/** The controls at the end of the bar, wherever a theme puts them. */
export { NavbarActions } from "@/core/components/layout/NavbarActions";

/**
 * The parts of the footer, for a theme that names `Footer` in its manifest
 * and draws its own: what it says, the language and the day or night a
 * visitor picks, what modules put there, and who made the software.
 */
export type { FooterProps } from "@/core/components/layout/Footer";
export { useFooter } from "@/core/hooks/useFooter";
export type { FooterContent, FooterContentColumn, FooterSocialLink } from "@/core/hooks/useFooter";
export type { FooterColumnLink } from "@/core/lib/footer-columns";
export { useLanguageChoice } from "@/core/hooks/useLanguageChoice";
export type { LanguageChoice } from "@/core/hooks/useLanguageChoice";
export { useDarkMode } from "@/core/hooks/useDarkMode";
export { FooterLink } from "@/core/components/layout/FooterLink";
export { FooterModuleControls } from "@/core/components/layout/FooterModuleControls";
export { FooterCredit } from "@/core/components/layout/FooterCredit";

export { PageBreadcrumb } from "@/core/components/layout/PageBreadcrumb";
export type { Crumb } from "@/core/components/layout/PageBreadcrumb";
export { SiteName, SiteMark } from "@/core/components/ui/site-name";

/**
 * A site placeholder where a theme puts it, `servers.online` in a badge, or a
 * sentence of the theme's own with some in it. A text setting the manifest
 * marks `"placeholders": true` needs neither: `useThemeConfig` fills it.
 */
export { Placeholder, PlaceholderText } from "@/core/components/placeholders/Placeholder";
export { usePlaceholder } from "@/core/hooks/usePlaceholder";

/** An address from a theme setting, only as a link a visitor may follow. */
export { linkTarget } from "@/core/lib/setting-link";
