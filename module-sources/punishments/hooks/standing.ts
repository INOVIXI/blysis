/**
 * Answers `member.standing`: what the record says this member may do.
 *
 * This is the half the module never had. It kept bans, mutes, kicks and
 * warnings, with reasons and durations, and nothing outside its own two
 * screens ever read a row - so a member with an active mute against their name
 * posted in the forum, and one with a permanent ban signed in. The record was
 * a list.
 *
 * Which kinds mean anything here is the interesting part, and the honest
 * answer is that two of the six do:
 *
 * - **ban** and **tempBan** close the account. Nothing to write and nowhere to
 *   write it.
 * - **mute** and **tempMute** take away writing and leave the door open. A
 *   silenced member can still read, still open a support ticket, and still
 *   appeal - taking those away would be a ban by another name.
 * - **kick** is a game server throwing somebody off a server. There is nothing
 *   on a website to throw them off of, and it is over the moment it happens.
 *   It is recorded because the record mirrors what the server did; it restricts
 *   nothing.
 * - **warning** is a warning. That is the whole of it.
 *
 * Only a row with a `userId` counts. A punishment reported against an in-game
 * name nobody has proved they own is a punishment against a name, and treating
 * it as a member's would let anyone silence anyone by taking their username on
 * a game server.
 *
 * Expiry is read here rather than trusted from the column: `active` says
 * nobody lifted it, and a temporary punishment stops on its own without
 * anything writing a row.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import { canonicalType, spellingsOf } from "../lib/punishment-types";

/** The spellings a game server plugin might have written, for each kind that restricts. */
const SILENCING = [...spellingsOf("mute"), ...spellingsOf("tempMute")];
const CLOSING = [...spellingsOf("ban"), ...spellingsOf("tempBan")];

const memberStanding: HookHandlerFor<"member.standing", "filter"> = async (current, context) => {
    // Nothing to add to an account that is already closed here.
    if (!current.mayEnter && !current.mayWrite) return current;
    if (!context?.userId) return current;

    const now = new Date();
    const held = await prisma.punishment.findMany({
        where: {
            userId: context.userId,
            active: true,
            type: { in: [...SILENCING, ...CLOSING] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { type: true, expiresAt: true },
        // Bounded because it is on the sign-in path. A member with more than
        // this many standing punishments is restricted either way, and the
        // strictest of them is what decides.
        take: 20,
    });
    if (held.length === 0) return current;

    let mayEnter = current.mayEnter;
    let mayWrite = current.mayWrite;
    let reasonKey: string | null = null;
    // The furthest away of the restrictions in force. Telling a member their
    // mute lifts on Tuesday when the ban runs to Friday is worse than saying
    // nothing.
    let until: Date | null = null;

    for (const row of held) {
        const kind = canonicalType(row.type);
        const closes = kind === "ban" || kind === "tempBan";

        if (closes) {
            mayEnter = false;
            mayWrite = false;
            reasonKey = "punishments.standingBanned";
        } else if (mayEnter) {
            mayWrite = false;
            // A ban already said more than a mute can.
            reasonKey = reasonKey ?? "punishments.standingSilenced";
        }

        // A permanent one ends the question: nothing lifts by itself.
        if (row.expiresAt === null) until = null;
        else if (until !== null && row.expiresAt > until) until = row.expiresAt;
        else if (until === null && !held.some((other) => other.expiresAt === null)) until = row.expiresAt;
    }

    return { mayEnter, mayWrite, until, reasonKey: reasonKey ?? current.reasonKey };
};

export default memberStanding;
