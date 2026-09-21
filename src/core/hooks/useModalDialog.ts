"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The keyboard half of a dialog.
 *
 * `role="dialog"` with `aria-modal="true"` is a promise to assistive
 * technology that the rest of the page is inert while the dialog is up.
 * Nothing in the DOM enforces that promise. Without a focus trap, Tab walks
 * straight out of the dialog and into the page behind the overlay, which is
 * still fully interactive and, to a sighted keyboard user, invisible: focus
 * lands on controls hidden under a black scrim. Without focus restoration,
 * closing the dialog drops focus on `document.body`, so the next Tab starts
 * over from the top of the page rather than from the control that opened it.
 *
 * Every dialog in the product carried the markup and only one carried the
 * behaviour, so this is that one implementation, moved somewhere the other
 * eleven can reach it.
 *
 * Usage:
 *
 * ```tsx
 * const dialogRef = useModalDialog(open, close);
 * return open ? <div ref={dialogRef} role="dialog" aria-modal="true">...</div> : null;
 * ```
 *
 * `onClose` is read through a ref, so passing an inline arrow does not tear
 * the listener down and set it up again on every render.
 *
 * A non-modal popover (a dropdown panel that leaves the page usable) wants
 * Escape and focus restoration but not the trap: pass `{ trapFocus: false }`.
 */

/**
 * Queried fresh on every Tab rather than once when the dialog opens: a dialog
 * whose contents change while it is up, such as a picker that filters a list
 * as you type, would otherwise trap against the buttons it had on open.
 */
const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // offsetParent is null for anything display:none, which is how a
        // collapsed section inside an open dialog hides its controls.
        (el) => el.offsetParent !== null || el === document.activeElement,
    );
}

export interface ModalDialogOptions {
    /** Wrap Tab at the dialog's edges. Off for a non-modal popover. */
    trapFocus?: boolean;
    /**
     * Where focus goes when the dialog opens.
     *
     * `true` puts it on the first control, which is right for a dialog
     * somebody asked for: they pressed a button and the thing they are most
     * likely to want next is under their hands.
     *
     * `"dialog"` puts it on the box. Focus still enters the dialog - that is
     * what keeps Tab inside it and what a screen reader follows - but no
     * control matches `:focus-visible`, so nothing wears a ring. That is
     * right for a dialog that arrives on its own: a marketing popup showed a
     * visitor who had clicked nothing a blue ring around "Close" on arrival.
     *
     * `false` leaves focus alone.
     */
    autoFocus?: boolean | "dialog";
}

export function useModalDialog<T extends HTMLElement = HTMLDivElement>(
    open: boolean,
    onClose: () => void,
    options: ModalDialogOptions = {},
): RefObject<T | null> {
    const { trapFocus = true, autoFocus = true } = options;
    const ref = useRef<T>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;

        // Captured before focus moves into the dialog, and restored on the way
        // out even if the trigger has since been re-rendered somewhere else.
        const previous = document.activeElement as HTMLElement | null;
        const container = ref.current;

        if (autoFocus && container) {
            const first = autoFocus === "dialog" ? null : focusableWithin(container)[0];
            if (first) {
                first.focus();
            } else {
                // Asked for, or nothing focusable inside: focus the dialog
                // itself so the screen reader lands on it, Tab has an edge to
                // wrap from, and Escape still reaches us.
                container.tabIndex = -1;
                container.focus();
            }
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== "Tab" || !trapFocus) return;

            const node = ref.current;
            if (!node) return;
            const focusable = focusableWithin(node);
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            // Focus that has already escaped the dialog, by a click on the page
            // behind or a programmatic move, is pulled back on the next Tab.
            if (!node.contains(active)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
                return;
            }
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            // Only take focus back if it is still inside the dialog or lost to
            // the body. Something else may have claimed it deliberately.
            //
            // `container` rather than `ref.current`: by the time this runs the
            // dialog has usually unmounted and React has already nulled the
            // ref. A detached node contains nothing, which is the same answer,
            // and reading the captured node keeps the rule about refs in
            // cleanups satisfied.
            const active = document.activeElement;
            const stillOurs = !active || active === document.body || container?.contains(active);
            if (stillOurs && previous?.isConnected) previous.focus();
        };
    }, [open, trapFocus, autoFocus]);

    return ref;
}
