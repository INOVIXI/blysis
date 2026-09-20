/**
 * Who may open which part of the panel.
 *
 * `scripts/generate-registry.ts` writes the table of which permission opens
 * which panel path, and `permission-map.ts` reads a path against it. Neither
 * had a caller in the product: the shell asked `isAdmin` and nothing else, so
 * every `admin.*` permission an operator could grant on the roles screen -
 * twenty-odd of them - changed nothing anybody could see. A permission that
 * grants nothing is worse than no permission: it reads as a control that
 * works.
 *
 * Three rules, and the third is what makes the rest safe to turn on.
 *
 * An administrator opens everything. That is what the role called `admin` has
 * always meant here and it is unchanged, so nobody who could reach the panel
 * before this existed loses anything: the only new answers are for people who
 * could not get in at all.
 *
 * Everybody else needs `admin.access` for the door and the screen's own
 * permission for the screen.
 *
 * A path nobody declared is an administrator's. `permission-map.ts` calls that
 * answer `undeclared` and says the enforcement reads it as no; a screen that
 * forgets to declare itself therefore fails closed rather than opening to
 * whoever happens to be inside the building.
 *
 * Pure, and takes the reader rather than a user id, because the proxy resolves
 * roles once per request and the shell and the sidebar have to reach the same
 * answer from the same facts. A second query is a second chance to disagree.
 */
import { adminPageRequirement } from "@/core/lib/permission-map";

/** What the panel knows about whoever is asking. */
export interface PanelReader {
    /** The role named `admin`, which bypasses rather than holds names. */
    isAdmin: boolean;
    permissions: ReadonlySet<string>;
}

/** The permission that opens the panel's front door. */
const PANEL_ACCESS = "admin.access";

/** Whether the panel is open to this reader at all. */
export function mayEnterPanel(reader: PanelReader): boolean {
    return reader.isAdmin || reader.permissions.has(PANEL_ACCESS);
}

/**
 * Whether this reader may open this panel path.
 *
 * The path carries its locale, the way the table is written: `/tr/admin/users`.
 * A query string and a trailing slash are stripped here rather than at each
 * call site, because a rule is anchored at the end of the path and every
 * caller that forgot would fail open.
 */
export function mayOpenAdminPath(reader: PanelReader, pathname: string): boolean {
    if (reader.isAdmin) return true;
    if (!mayEnterPanel(reader)) return false;

    const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
    const needed = adminPageRequirement(path);
    if (needed.kind === "permission") return reader.permissions.has(needed.name);
    // `open` describes a write a member or the public may make and is not a
    // shape a panel screen takes; treating it as a refusal keeps the one
    // direction this file fails in.
    return false;
}
