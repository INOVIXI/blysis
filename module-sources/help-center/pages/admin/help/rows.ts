/**
 * What the two lists on the help centre's panel are made of.
 *
 * Shared by the screen and the two forms it opens, because a form fills
 * itself from the row it was opened on and a list redraws from what the form
 * saved. Two copies of these shapes drifted apart once already: the screen
 * carried a `_count` the form did not, so a category opened for editing lost
 * the number of articles under it until the next read.
 */

export interface AdminHelpCategory {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    image?: string | null;
    isActive: boolean;
    _count?: { articles: number };
}

export interface AdminHelpArticle {
    id: string;
    title: string;
    slug: string;
    content: string;
    views: number | null;
    helpful: number;
    notHelpful: number;
    isActive: boolean;
    category: { id: string; name: string } | null;
}

/**
 * The address a form lives at.
 *
 * Two kinds of thing are edited on one screen, so the parameter says which
 * and, when there is one, which row: `?form=article`, `?form=category`,
 * `?form=article:how-to-appeal-a-ban`, `?form=category:cmu34g...`. A colon
 * appears in neither a slug nor a cuid, so the split is unambiguous.
 */
export type FormTarget =
    | { kind: "article" | "category"; key: null }
    | { kind: "article" | "category"; key: string };

export function readFormTarget(param: string | null): FormTarget | null {
    if (!param) return null;
    const [kind, ...rest] = param.split(":");
    if (kind !== "article" && kind !== "category") return null;
    const key = rest.join(":");
    return { kind, key: key || null } as FormTarget;
}

export function formTargetParam(kind: "article" | "category", key?: string | null): string {
    return key ? `${kind}:${key}` : kind;
}
