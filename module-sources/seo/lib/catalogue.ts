/**
 * The two halves of the SEO screen: what a page says about itself, and what an
 * operator has said instead.
 *
 * Shared between the screen and the panes it draws so the shapes cannot drift
 * apart. The catalogue half mirrors what `listCataloguePages` returns from the
 * SDK; it is restated rather than imported because the pane is a client
 * component and the SDK entry that carries it is server only.
 */

export interface CataloguePage {
    /** Path below the locale segment. `/` is the home page. */
    path: string;
    title: string;
    description: string;
    /** `core`, or the id of the module that serves it. */
    owner: string;
    indexable: boolean;
    /** The path carries a dynamic segment and stands for many pages. */
    pattern: boolean;
}

export interface SeoOverride {
    id: string;
    path: string;
    metaTitle: string | null;
    metaDescription: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    keywords: string | null;
    canonical: string | null;
    noIndex: boolean;
    noFollow: boolean;
}

/** What the form edits. Every field empty means "leave the page as it is". */
export interface OverrideForm {
    metaTitle: string;
    metaDescription: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
    keywords: string;
    canonical: string;
    noIndex: boolean;
    noFollow: boolean;
}

export const EMPTY_OVERRIDE: OverrideForm = {
    metaTitle: "",
    metaDescription: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
    keywords: "",
    canonical: "",
    noIndex: false,
    noFollow: false,
};

export function formFrom(override: SeoOverride | undefined): OverrideForm {
    if (!override) return EMPTY_OVERRIDE;
    return {
        metaTitle: override.metaTitle ?? "",
        metaDescription: override.metaDescription ?? "",
        ogTitle: override.ogTitle ?? "",
        ogDescription: override.ogDescription ?? "",
        ogImage: override.ogImage ?? "",
        keywords: override.keywords ?? "",
        canonical: override.canonical ?? "",
        noIndex: override.noIndex,
        noFollow: override.noFollow,
    };
}

/**
 * Whether the form still says nothing at all.
 *
 * Saving an empty form is how an operator undoes an override, so the screen
 * deletes the row rather than storing nine nulls: a row of nulls and no row
 * mean the same thing to a crawler, but only one of them makes the list say
 * this page has been customised.
 */
export function saysNothing(form: OverrideForm): boolean {
    return (
        !form.metaTitle.trim() &&
        !form.metaDescription.trim() &&
        !form.ogTitle.trim() &&
        !form.ogDescription.trim() &&
        !form.ogImage.trim() &&
        !form.keywords.trim() &&
        !form.canonical.trim() &&
        !form.noIndex &&
        !form.noFollow
    );
}
