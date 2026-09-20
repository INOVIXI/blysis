/**
 * What the panel's search may offer, and under what name.
 *
 * Two rules, both learned from what the endpoint used to answer.
 *
 * A result has to be somewhere a link can go. Module admin routes were
 * offered by scoring their path, so searching "edit" answered with
 * `/admin/blog/articles/[id]/edit` - the pattern, not a page - and clicking it
 * asked the server for an article whose id is the four characters `[id]`.
 *
 * And a result is named by something a person reads. A module route was
 * titled with the last segment of its path and subtitled with the module's
 * id, so a search for "settings" returned a column in which every row was an
 * identifier written twice. A module has a name, declared in its manifest and
 * translated in both locales as `module_<id>_name`; that is the name.
 */

/** A route pattern, rather than an address: `/store/orders/[id]`. */
function isRoutePattern(path: string): boolean {
    return path.includes("[");
}

export interface AdminSearchRoute {
    key: string;
    path: string;
    module: string;
    isAdmin?: boolean;
}

/**
 * The module admin routes worth offering: the ones that are addresses, and
 * that the panel does not already list somewhere with a name of its own.
 *
 * `covered` is every href the reader is offered elsewhere - the navigation
 * they can see and the settings cards - passed in rather than read here,
 * because the navigation is built in the browser from what this reader has.
 */
export function offerableRoutes(
    routes: readonly AdminSearchRoute[],
    covered: ReadonlySet<string>,
): AdminSearchRoute[] {
    return routes.filter(
        (route) => route.isAdmin && !isRoutePattern(route.path) && !covered.has(route.path),
    );
}
