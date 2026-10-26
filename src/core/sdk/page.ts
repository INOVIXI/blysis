/**
 * Blysis module SDK - a module's page arranged from blocks a theme may place.
 *
 * An entry of its own rather than part of `@/core/sdk/server` or
 * `@/core/sdk/layout`. It reads the active theme on the server, so a client
 * page that imports `layout` cannot carry it; and `server` is imported by
 * nearly every route, an API route as much as a page, which drawing a page
 * would hand the theme's components loaded with `next/dynamic`. A route that
 * never draws one then had a server build naming client chunks its own client
 * build never wrote, and the homepage asked for four of them and got a 404.
 * `the-server-sdk-reaches-no-theme-component.test.ts` holds the line.
 */
export { ArrangedPage, type ArrangedPageProps } from "@/core/components/layout/ArrangedPage";
