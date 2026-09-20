import Image from "next/image";
import { memberInitials, avatarTone } from "@/core/lib/member-initials";
import { cn } from "@/core/lib/utils";

/**
 * A member's face, wherever one is drawn.
 *
 * There were five of these, each written where it was needed: a letter on a
 * pale square in the members list, a grey silhouette in the activity feed, a
 * circle in the forum, another in the staff list. They disagreed about size,
 * shape and what to draw when there is no picture - which is most members.
 *
 * One component, and no picture is not a missing state: it is initials on a
 * colour the name picks, so the same person is the same colour on every
 * screen and a list of twenty reads as twenty people.
 *
 * A server component. It renders in a table on the server and inside a client
 * list alike, holds no state, and reads no setting: whether a member may
 * upload at all is the operator's question, answered where the upload control
 * is drawn, not here.
 */

export interface MemberAvatarProps {
    /** The name the initials and the colour come from. */
    name: string;
    /** Their picture, when they have one. */
    src?: string | null;
    /** Pixels. The circle, the text and the image all follow it. */
    size?: number;
    className?: string;
}

export function MemberAvatar({ name, src, size = 40, className }: MemberAvatarProps) {
    const label = name?.trim() || "?";

    if (src) {
        return (
            <Image
                src={src}
                alt={label}
                width={size}
                height={size}
                // The address is whatever a member uploaded or linked, and
                // which host answered is not core's business to optimise.
                unoptimized
                className={cn("rounded-full object-cover shrink-0", className)}
                style={{ width: size, height: size }}
            />
        );
    }

    return (
        <span
            // The name is already beside this everywhere it is drawn, so the
            // letters are decoration to a screen reader and saying them twice
            // is noise.
            aria-hidden="true"
            className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
                avatarTone(label),
                className,
            )}
            style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
        >
            {memberInitials(label)}
        </span>
    );
}
