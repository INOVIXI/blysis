/**
 * Blysis module SDK - page composition.
 *
 * A module page that renders a full public screen needs the site chrome; a
 * module that contributes into a slot needs `Slot`. Both are stable contracts
 * - the theme system replaces what these render, so a module never needs to
 * know which theme is active.
 */
export { Navbar, Footer } from "@/core/components/layout";
/**
 * The whole public page: chrome, measure, crumb trail, title, and the column
 * a sidebar goes in. `StandardSidebarLayout` stays exported for a page that
 * needs two columns somewhere other than under a page header.
 */
export { PageFrame } from "@/core/components/layout/PageFrame";
export type { PageFrameProps } from "@/core/components/layout/PageFrame";
/**
 * A page drawn in the browser, arranged from the blocks its manifest
 * declares as the active theme says. A server page takes `ArrangedPage`
 * from `@/core/sdk/page` instead.
 */
export { ArrangedClientPage } from "@/core/components/layout/ArrangedClientPage";
export type { ArrangedClientPageProps } from "@/core/components/layout/ArrangedClientPage";
export { default as StandardSidebarLayout } from "@/core/components/layout/SidebarLayout";
export { Slot } from "@/core/components/Slot";
