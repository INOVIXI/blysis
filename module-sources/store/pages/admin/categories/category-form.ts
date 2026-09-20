/**
 * What the category form holds, and where it writes.
 *
 * The screen could create and delete a shelf and never edit one, so a name
 * typed wrongly meant deleting the shelf - and every product's place on it -
 * and building it again. It also left the shelf gate settable through the API
 * alone: the column existed and no form could reach it.
 *
 * Creating and editing differ in exactly two things and both fail quietly.
 * The wrong address makes a second category that looks like a successful edit
 * until somebody counts them; the wrong verb sends a partial row to a route
 * that wanted a whole one.
 */

export interface CategoryFormValue {
    name: string;
    description: string;
    image: string;
    parentId: string;
    /** Held as a string because the box is one; "" is zero, not "no order". */
    order: string;
    isActive: boolean;
    /** Own any one of these to see the shelf. Empty shows it to everybody. */
    visibleAfterProductIds: string[];
    /** `grid` or `table`: cards to browse, or a ladder to compare. */
    layout: string;
}

export const EMPTY_CATEGORY: CategoryFormValue = {
    name: "",
    description: "",
    image: "",
    parentId: "",
    order: "0",
    isActive: true,
    visibleAfterProductIds: [],
    layout: "grid",
};

/** The address and verb for saving, given what is being edited. */
export function categoryWriteTarget(editingId: string | null): { url: string; method: "POST" | "PATCH" } {
    return editingId
        ? { url: `/api/v1/store/categories/${editingId}`, method: "PATCH" }
        : { url: "/api/v1/store/categories", method: "POST" };
}

/** What the form sends. */
export function categoryPayload(value: CategoryFormValue) {
    const order = Number(value.order);
    return {
        name: value.name,
        description: value.description,
        image: value.image || null,
        // "" is a category id that matches nothing, and it would be taken for
        // a real one and fail on a foreign key nobody could read.
        parentId: value.parentId || null,
        order: Number.isFinite(order) ? order : 0,
        isActive: value.isActive,
        visibleAfterProductIds: value.visibleAfterProductIds,
        layout: value.layout,
    };
}
