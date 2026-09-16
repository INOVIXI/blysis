/**
 * What a path requires, answered from the generated table.
 *
 * Three readers need this answer and used to compute it three ways: the admin
 * shell asked `isAdmin`, the sidebar drew whatever a manifest listed, and the
 * endpoints each wrote their own check. A screen could therefore be linked and
 * refused, or reachable and unlisted, and a handler could disagree with the
 * screen that called it. They read one table now.
 *
 * `undeclared` is a real answer, and the enforcement reads it as no. A panel
 * path nobody declared is reachable by an administrator and nobody else: the
 * safe direction, and one the gates fail on before it ships.
 */

import { ADMIN_PAGE_RULES, API_WRITE_RULES, type PermissionRule } from "@/core/generated/permission-map";

export type Requirement =
    | { kind: "permission"; name: string }
    | { kind: "open"; openTo: "member" | "public" }
    | { kind: "undeclared" };

const UNDECLARED: Requirement = { kind: "undeclared" };

function requirementFrom(rules: PermissionRule[], pathname: string): Requirement {
    for (const rule of rules) {
        if (!rule.pattern.test(pathname)) continue;
        if (rule.permission) return { kind: "permission", name: rule.permission };
        if (rule.openTo) return { kind: "open", openTo: rule.openTo };
        return UNDECLARED;
    }
    return UNDECLARED;
}

/**
 * For a panel path, with its locale segment: `/tr/admin/users`.
 *
 * The query string and any trailing slash are the caller's to strip; a rule is
 * anchored at the end of the path, because a rule for `/admin/users` that also
 * matched `/admin/users/42/impersonate` would answer for a screen it has never
 * seen.
 */
export function adminPageRequirement(pathname: string): Requirement {
    return requirementFrom(ADMIN_PAGE_RULES, pathname);
}

/**
 * For a write to an endpoint: `/api/v1/users`.
 *
 * Reads are not here. A read is gated by the screen that does the reading, and
 * an entry declared for every method commonly serves a public list from GET
 * and an operator's create from POST - so gating the pair together would take
 * the list off a public page.
 */
export function apiWriteRequirement(pathname: string): Requirement {
    return requirementFrom(API_WRITE_RULES, pathname);
}
