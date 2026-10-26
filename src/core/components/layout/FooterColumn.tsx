"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * One column of footer links, folded on a phone.
 *
 * Measured at 390px on 2026-09-11: the footer ran 670px of a 1933px page.
 * Every column stacks into one below `md`, each link is a 56px tap row, and
 * the quick links column alone held nine of them - so a visitor who reached
 * the end of an article met a second navigation the length of a screen, built
 * from the same list the header already offers.
 *
 * Above `sm` nothing folds: the columns sit side by side and there is room for
 * all of them, so the heading is a heading and the list is open. The button
 * only exists at the width where the fold is worth having, which is also why
 * it is a button inside the heading rather than instead of it - the page's
 * outline does not change with the viewport. Wider, the heading holds the
 * words alone: a button that did nothing there was still a control named
 * after the column, beside a link of the same name when a module's page is
 * called what its section is (`a-control-says-which-one-it-is`).
 */
export function FooterColumn({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
        <div>
            <h2 className="font-semibold text-foreground mb-4">
                <span className="hidden sm:inline">{title}</span>
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                    className="sm:hidden flex w-full items-center justify-between gap-2 text-left cursor-pointer"
                >
                    {title}
                    <ChevronDown
                        aria-hidden="true"
                        className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                    />
                </button>
            </h2>
            <div className={open ? "block" : "hidden sm:block"}>{children}</div>
        </div>
    );
}
