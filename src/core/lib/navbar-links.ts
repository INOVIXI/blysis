/**
 * How many links the bar draws before it folds the rest away.
 *
 * By count, not by measurement: a number renders the same on the server as in
 * the browser, while anything measured is known only after paint - which puts
 * a layout shift in the header of every page. Eight is what fits beside the
 * account controls at the width the bar started wrapping.
 */
export const INLINE_NAV_LINKS = 8;

export interface NavbarLink {
    label: string;
    /** The module's own translation key, where it declared one. */
    labelKey?: string;
    href: string;
    icon?: string;
    children?: NavbarLink[];
}

/**
 * The shape the bar is drawn in: what fits, then everything else under one
 * entry.
 *
 * This used to be a branch at render time, and the only condition on it was
 * that nobody had saved a navbar yet. The editor seeded itself from the
 * registry instead - every link, flat, no fold - so an operator opened it,
 * saw a different bar from the one on their own site, pressed Save to change
 * one label and lost the fold: nine links inline and a bar that overflows,
 * with no way back except building the dropdown by hand.
 *
 * One function, asked by both, so the two cannot disagree. And a fold that
 * gets saved is data like any other link: each folded entry keeps its own
 * translation key, or it would be frozen in whichever language the operator
 * happened to be reading when they pressed Save.
 */
export function foldNavLinks(links: readonly NavbarLink[], moreLabel: string): NavbarLink[] {
    if (links.length <= INLINE_NAV_LINKS) return [...links];

    // Already folded: the editor seeds itself with this shape and hands it
    // back, and a fold inside a fold is a menu nobody can reach.
    const last = links[links.length - 1];
    if (links.length === INLINE_NAV_LINKS + 1 && last.href === "#" && (last.children?.length ?? 0) > 0) {
        return [...links];
    }

    return [
        ...links.slice(0, INLINE_NAV_LINKS),
        {
            label: moreLabel,
            href: "#",
            icon: "MoreHorizontal",
            children: links.slice(INLINE_NAV_LINKS).map((link) => ({
                label: link.label,
                labelKey: link.labelKey,
                href: link.href,
                icon: link.icon,
            })),
        },
    ];
}
