/**
 * What a member may do, asked once and answered in one place.
 *
 * Three things on this site called themselves punishment and none of them
 * punished. A module kept a record of bans and mutes that nothing outside its
 * own screens ever read, so a muted member posted and a banned one signed in.
 * Core kept a warning counter whose threshold action promised an auto-mute and
 * had no listener. And core kept `User.isBanned`, which really did refuse a
 * sign-in and knew nothing about either of the other two.
 *
 * They were three answers to one question, so there is one question now. Core
 * asks it, modules answer it, core enforces the answer. Core names no module
 * and reads no module's table: a punishment record, a subscription, a
 * probation period during review - anything that has an opinion about whether
 * somebody may take part answers the same filter.
 *
 * Two rules keep it honest.
 *
 * **A module may only restrict.** Every answer is an AND, so a module cannot
 * hand back what core took away. Otherwise a row written into a module's table
 * would be a way to unban an account, and the module tables are the ones a
 * game server plugin writes into over a connection an operator configured.
 *
 * **The reason is a message key.** What a member is told when they are refused
 * is a sentence in their own language; `mute`, `tempBan` and `silenced` are
 * how the code refers to a thing. See the naming rule in CLAUDE.md 11a.
 *
 * Deliberately not cached. Being let back in has to take effect now: an
 * operator lifting a ban and then telling the member to try again is the
 * moment a stale answer costs the most, and this is one indexed read on a
 * path that already does several.
 */
import { prisma } from "@/core/lib/db";
import { applyFiltersAsync } from "@/core/lib/hooks";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";

export interface MemberStanding {
    /** May sign in and hold a session. */
    mayEnter: boolean;
    /** May write anything other members will read. */
    mayWrite: boolean;
    /** When the restriction lifts. Null when it does not, or when nothing said. */
    until: Date | null;
    /**
     * Why, as a message key the screen translates. Null when nothing is
     * restricted. Never an identifier: a member reads this.
     */
    reasonKey: string | null;
}

/** Nothing is restricted. */
const CLEAR: MemberStanding = { mayEnter: true, mayWrite: true, until: null, reasonKey: null };

/**
 * Nobody, which is what a signed-out reader and a deleted account both are.
 * Answering "clear" for an unknown id would make a mistyped id a way past
 * every check built on this.
 */
const NOBODY: MemberStanding = {
    mayEnter: false,
    mayWrite: false,
    until: null,
    reasonKey: "standing.notAMember",
};

export async function memberStanding(userId: string): Promise<MemberStanding> {
    if (!userId) return NOBODY;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isBanned: true, banReason: true },
    });
    if (!user) return NOBODY;

    const core: MemberStanding = user.isBanned
        ? { mayEnter: false, mayWrite: false, until: null, reasonKey: "standing.bannedHere" }
        : CLEAR;

    // A module that has nothing to say answers with what it was given, so a
    // site with no punishment module installed gets core's own answer back.
    await ensureHooks();
    const answered = await applyFiltersAsync("member.standing", core, { userId });

    return narrowest(core, answered);
}

/**
 * The strictest of the two, field by field. A module answering more freely
 * than core is answering a question it was not asked.
 */
function narrowest(core: MemberStanding, answered: MemberStanding): MemberStanding {
    const mayEnter = core.mayEnter && answered.mayEnter === true;
    const mayWrite = core.mayWrite && answered.mayWrite === true;

    // The reason belongs to whichever restriction is actually in force, and
    // core's comes first: an account closed here is not explained by a mute
    // somewhere else.
    const reasonKey = !core.mayEnter || !core.mayWrite
        ? core.reasonKey
        : (mayEnter && mayWrite ? null : answered.reasonKey ?? null);

    return {
        mayEnter,
        mayWrite,
        until: mayEnter && mayWrite ? null : answered.until ?? null,
        reasonKey,
    };
}
