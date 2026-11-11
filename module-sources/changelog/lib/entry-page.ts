/**
 * Which release entries have a page of their own, and how to reach one.
 *
 * The timeline is a list of releases and most of them are one line: a version,
 * a word about what changed, done. A few are not - a release somebody needs to
 * explain, with a screenshot of the new screen and the reason the third
 * attempt was the one that shipped. Those get a page.
 *
 * So the link is conditional. An entry with nothing more to say must not look
 * like it is hiding something: a title that is a link and leads to a copy of
 * the line above it is worse than no link, because a reader learns the links
 * are not worth following.
 *
 * The URL is built from `number`, which never changes, with the slug beside it
 * for a reader. Renaming a release rewrites the slug and every link already
 * shared still lands, the same way an article works.
 */

/** The shape both the list and the page need in order to decide. */
export interface LinkableEntry {
    number: number;
    slug: string;
    details?: string | null;
}

/** True when this entry has something a page would add. */
export function hasPage(entry: Pick<LinkableEntry, "details">): boolean {
    return typeof entry.details === "string" && entry.details.trim() !== "";
}

/** Where that page lives, or null when there is not one. */
export function entryHref(entry: LinkableEntry): string | null {
    if (!hasPage(entry)) return null;
    return `/changelog/${entry.number}/${entry.slug || "release"}`;
}

/**
 * A slug from whatever the operator typed.
 *
 * Cosmetic, so it is allowed to be empty: the page resolves by number and an
 * entry whose title is written in a script with no ASCII at all still gets a
 * working link. Bounded because it goes in a URL somebody may read aloud.
 */
export function entrySlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

/**
 * The entry number out of whatever the module page router handed over.
 *
 * A module page mounted on a catch-all receives every segment after the
 * locale, so the first one is the module's own path and not the number. Read
 * blindly, the page asks for `/changelog/entry/changelog`, gets a 404, and
 * renders "nothing more to show" - which is indistinguishable from an entry
 * that genuinely has no page. It cost a measurement to see, twice, on two
 * different modules.
 */
export function entryNumberFrom(raw: string | string[] | undefined): string | null {
    const segments = typeof raw === "string" ? raw.split("/") : Array.isArray(raw) ? raw : [];
    const at = segments.indexOf("changelog");
    const candidate = at >= 0 ? segments[at + 1] : segments[0];
    return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

/**
 * Whose translations these are, in core's table, and the fields that have
 * them: each language held to its column's own limit. The version and the
 * kind are the same in every language.
 */
export const ENTRY_TEXT = { owner: "changelog", entity: "entry" };
export const TRANSLATED_FIELDS = { title: 200, content: 10_000, details: 50_000 };
