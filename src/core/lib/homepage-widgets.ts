/**
 * Which homepage widgets render, and in what order.
 *
 * Admin > Settings > Widgets writes two keys through `/api/v1/settings`:
 * `widget_visibility` (widget id -> boolean) and `widget_order` (widget ids,
 * first to last). The homepage honoured neither. `widget_order` was read by
 * no file in the repository, and `widget_visibility` never reached the
 * browser: the homepage reads it through `useSiteSettings`, which fetches
 * `/api/v1/public-settings`, and that endpoint publishes a fixed allowlist
 * that did not name either key. Hiding a widget and dragging one into place
 * both reported "saved" and left the page they configure exactly as it was.
 *
 * A manifest's `defaultVisible` was ignored for a third reason: the default
 * was hardcoded to visible rather than read from the declaration, so a module
 * that ships a widget switched off would have had it switched on.
 *
 * Both screens now go through here, the homepage by way of `resolveLayout`
 * on the server, so the customiser and the homepage cannot disagree about
 * what an unsaved widget does.
 */

/** The registry fields this module needs; `ModuleWidgets` entries satisfy it. */
export interface HomepageWidget {
    id: string;
    defaultVisible: boolean;
}

/** Whether one widget shows, given the saved `widget_visibility` map. */
export function isWidgetVisible(widget: HomepageWidget, visibility: unknown): boolean {
    const saved = (visibility as Record<string, unknown> | null | undefined)?.[widget.id];
    return typeof saved === "boolean" ? saved : widget.defaultVisible !== false;
}

/**
 * Sorts by the saved `widget_order`, declared order for the rest.
 *
 * A widget the saved order never names - one whose module was installed after
 * the admin last pressed save - keeps its declared position and follows every
 * widget that was named, rather than silently jumping to the front.
 */
export function orderWidgets<T extends HomepageWidget>(widgets: T[], order: unknown): T[] {
    const saved = new Map<string, number>();
    if (Array.isArray(order)) {
        for (const id of order) {
            if (typeof id === "string" && !saved.has(id)) saved.set(id, saved.size);
        }
    }
    const declared = new Map(widgets.map((w, i) => [w.id, saved.size + i]));
    const rank = (w: T) => saved.get(w.id) ?? declared.get(w.id) ?? 0;
    return [...widgets].sort((a, b) => rank(a) - rank(b));
}
