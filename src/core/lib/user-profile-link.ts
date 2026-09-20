/**
 * Where a username points, if anywhere.
 *
 * Core writes a username in a few places of its own - the activity feed on
 * the home page, the audit log - and linked every one of them to
 * `/profile/<username>`. That is not a route: `/profile` is the signed-in
 * visitor's own page and takes no segment, so every one of those links
 * answered 404. The name that hurt most was the activity feed's, which is on
 * the home page of every install that turned it on.
 *
 * Core cannot fix that by writing `/u/<username>` instead, because that
 * path belongs to a module that may not be installed. So the module that
 * serves profiles declares `userProfile: true` on the route, and core asks
 * the registry. With no such module, a username is text rather than a link to
 * nowhere.
 */

import { ModuleRoutes } from "@/core/generated/module-registry";
import { isEnabledIn } from "@/core/lib/module-enabled";

/**
 * The declared profile route pattern, e.g. `/u/[username]`.
 *
 * A registry entry only says the module's files are installed. An admin who
 * has turned that module off is served a 404 at its routes, so its pattern is
 * no better than the one this replaced, and the states map decides.
 */
export function userProfileRoutePattern(states: Record<string, boolean>): string | null {
    const route = ModuleRoutes.find((r) => r.userProfile && !r.isAdmin && isEnabledIn(states, r.module));
    return route?.path ?? null;
}

/**
 * The path for one person's profile, or null when nothing serves profiles.
 * The username is encoded: it reaches this from a database row, and a name
 * carrying a slash would otherwise invent a path segment.
 */
export function userProfilePath(
    username: string | null | undefined,
    states: Record<string, boolean>,
): string | null {
    const pattern = userProfileRoutePattern(states);
    if (!pattern || !username) return null;
    const replaced = pattern.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/, encodeURIComponent(username));
    // A pattern with no dynamic segment would have come back unchanged, and
    // linking every person to the same page is worse than not linking.
    return replaced === pattern ? null : replaced;
}
