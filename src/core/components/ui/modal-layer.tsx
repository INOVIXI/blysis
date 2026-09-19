"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Where a modal is drawn: the body, not where it was opened from.
 *
 * A dialog used to render in place, which made it a descendant of whatever
 * opened it. Every admin screen that edits a row is one `<form>`, and a field
 * inside it opens the media library, so the library's search box was a
 * `<form>` inside a `<form>` - invalid HTML, and a hydration error on every
 * screen with an image field.
 *
 * The nesting was the visible half. The other half is that a `<button>` with
 * no `type` is a submit button, so every control in a dialog inside a form
 * was one: closing the picker saved the row behind it.
 *
 * Both follow from the same thing, and so do the two an overlay always has to
 * fight - an ancestor's `overflow` clipping it, and an ancestor's stacking
 * context burying it under the page. Leaving the subtree answers all four.
 *
 * React's events still travel the React tree rather than the DOM, so a submit
 * raised inside a portal reaches the form's `onSubmit` regardless. A dialog
 * that needs a form of its own has to stop that event itself; the ones here
 * do not have forms.
 *
 * Nothing is rendered on the first pass: `document` does not exist while the
 * server renders, and a portal that appears only after mount is also what
 * keeps the markup the server sent identical to the markup the client builds
 * from it.
 */
export function ModalLayer({ children }: { children: React.ReactNode }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) return null;
    return createPortal(children, document.body);
}
