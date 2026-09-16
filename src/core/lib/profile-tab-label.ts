/**
 * What a section of a member's account is called.
 *
 * A module contributes a section and gives it a `label`, which is English
 * prose. The name a reader actually saw came from `profileTab_<id>` in core's
 * own message file: four of the nine sections had an entry there and the
 * other five printed their English label to a Turkish reader. It was also the
 * wrong file - an entry called `profileTab_ProfileOrdersTab` is core knowing
 * the shop exists.
 *
 * So a section declares `labelKey` and the name lives in the module's own
 * translations. Unlike a widget's key, which is resolved in the shared
 * `admin` namespace, this one is `namespace.key` from the root: a module's
 * user-facing strings live under its own namespace, and asking it to write
 * into a shared one to name its own section is the coupling this removed.
 */

export interface LabelledProfileTab {
    id: string;
    label: string;
    labelKey?: string;
}

/**
 * `translate` is a next-intl `t` and `has` its `t.has`, passed in so this
 * stays a pure function the tests can drive without a provider.
 */
export function profileTabLabel(
    tab: LabelledProfileTab,
    has: (key: string) => boolean,
    translate: (key: string) => string,
): string {
    if (tab.labelKey && has(tab.labelKey)) return translate(tab.labelKey);
    return tab.label;
}
