"use client";

import { useState } from "react";
import Image from "next/image";
import { memberInitials, avatarTone } from "@/core/lib/member-initials";
import { memberFaceSources } from "@/core/lib/member-face";
import { useMemberFaceRules } from "@/core/components/MemberFaceProvider";
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
 * Which picture, if any, is the site's rule rather than the caller's: the
 * member's own while the operator allows member pictures, then the picture
 * service the operator chose, asked by name (`member-face.ts`). A picture that
 * does not load gives way to the next and finally to the initials, which is
 * why this is a client component: noticing a failed image takes the browser.
 * It still renders from a server table and a client list alike, and reads the
 * rules from `MemberFaceProvider`, which the root layout fills.
 */

export interface MemberAvatarProps {
    /** The name the initials and the colour come from, and a provider is asked by. */
    name: string;
    /** Their picture, when they have one. */
    src?: string | null;
    /** Pixels. The circle, the text and the image all follow it. */
    size?: number;
    className?: string;
}

export function MemberAvatar({ name, src, size = 40, className }: MemberAvatarProps) {
    const label = name?.trim() || "?";
    const rules = useMemberFaceRules();
    // Remembered by address rather than by position, so a list that reuses
    // this component for another member does not inherit a failure.
    const [failed, setFailed] = useState<readonly string[]>([]);
    const picture = memberFaceSources(rules, { name: name ?? "", src, size })
        .find((candidate) => !failed.includes(candidate));

    if (picture) {
        return (
            <Image
                key={picture}
                src={picture}
                alt={label}
                width={size}
                height={size}
                // The address is whatever a member uploaded or linked, or a
                // service the operator chose, and which host answered is not
                // core's business to optimise.
                unoptimized
                onError={() => setFailed((before) => [...before, picture])}
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
