import type { ReactNode } from "react";

interface BlockHeadingProps {
    /** A short line over the title; a theme may draw it as a coloured label. */
    kicker?: ReactNode;
    title: ReactNode;
    /** Drawn at the far end of the heading: a "see all" link, a set of tabs. */
    action?: ReactNode;
    id?: string;
}

/**
 * The heading over a block that is a section of its own, so every block's
 * heading is the same element and a theme styles one (`data-block-heading`,
 * `data-kicker`). Without a kicker it is the section heading the homepage
 * always had, a heading line and its margin, which the sidebar's heading
 * spacer answers.
 */
export function BlockHeading({ kicker, title, action, id }: BlockHeadingProps) {
    return (
        <div data-block-heading className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
                {kicker ? <span data-kicker className="mb-2 block text-xs font-bold uppercase tracking-widest text-primary">{kicker}</span> : null}
                <h2 id={id} className="text-xl font-bold text-foreground">{title}</h2>
            </div>
            {action ? <div data-block-heading-action className="min-w-0">{action}</div> : null}
        </div>
    );
}
