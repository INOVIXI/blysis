/**
 * The refusal a silenced member gets, written once.
 *
 * A mute on the record stopped nothing: every endpoint that takes something a
 * member wrote checked that they were signed in and wrote it. Making each of
 * those ask `memberStanding` itself would work and would rot - the next
 * endpoint somebody adds is the one that forgets, and the failure is silent
 * and invisible until a moderator notices the person they muted is still
 * posting.
 *
 * So there is one call, it returns a response or nothing, and
 * `a-silenced-member-cannot-write.test.ts` reads the source of every endpoint
 * that takes member-written content and fails on one that does not make it.
 *
 * The refusal is translated here rather than handed over as a key, and that is
 * not the obvious choice. The client convention is `code` and the caller looks
 * up `err.<code>` in its own catalogue - which works when the failure belongs
 * to the thing being written, and does not work for this one: a scoped
 * translator cannot reach a key outside its namespace, so the forum would have
 * to declare the sentence, and the blog, and the market, and each of them would
 * be a place for it to drift. The server knows the key and can work out the
 * language, so the server says it.
 *
 * A 403 whose body is "mute" is a machine name on a member's screen, which is
 * the thing 11a is about.
 */
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { resolveLocaleFromRequest } from "./i18n/resolve-locale";
import { memberStanding } from "./member-standing";

/**
 * Null when this member may write. Otherwise the response to return, already
 * shaped the way `apiError` shapes one.
 *
 * Returns a refusal for an empty id, so an endpoint that forgets its own
 * session check fails closed rather than open.
 */
export async function refuseSilenced(userId: string | undefined | null): Promise<NextResponse | null> {
    const standing = await memberStanding(userId ?? "");
    if (standing.mayWrite) return null;

    return NextResponse.json(
        {
            // English, for a log. The reader gets `reasonText`.
            error: "You cannot post at the moment",
            code: "member_silenced",
            // Nothing here spells out which punishment, which module, or who
            // issued it: a refusal is not the place to publish somebody's
            // record to whoever managed to trigger it.
            reasonText: await say(standing.reasonKey),
            until: standing.until ? standing.until.toISOString() : null,
        },
        { status: 403 },
    );
}

/**
 * One key, in the reader's language.
 *
 * A key that is missing renders as itself, which is the tell to declare it -
 * the alternative is a refusal that says nothing and a member who cannot work
 * out why their comment vanished.
 */
async function say(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
        const locale = await resolveLocaleFromRequest();
        const t = await getTranslations({ locale });
        return t(key as never);
    } catch {
        return key;
    }
}
