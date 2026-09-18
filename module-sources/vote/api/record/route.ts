import { NextRequest, NextResponse } from "next/server";
import { prisma, rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { voteClaimSchema } from "../../lib/validations";

/**
 * POST /api/v1/vote/record - record that this user went to a listing site.
 *
 * Called by their own browser right after the listing opens, so what it
 * records is the click. No listing calls back here, which means the site
 * cannot know whether a vote was actually cast - and the screens say clicks
 * rather than votes for that reason. A listing's postback would be the thing
 * that makes the word "vote" true; until then it is not ours to use.
 *
 * This used to be `/claim`, and it moved credits: each site carried a reward
 * and voting paid it out. The module sends people to a server listing to
 * vote and nothing more now, so the payout, the credit transaction and the
 * dependency on the credits module are gone.
 *
 * The log itself stays. It is what the 24-hour cooldown is derived from, what
 * the leaderboard counts to rank voters, and what the trophy engine counts
 * for the "Voter" badge - none of which was ever about the reward.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimitForRoleAsync(
        `vote-record:${session.user.id}`,
        { maxRequests: 10, windowMs: 3_600_000 },
        session.user.role
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    }

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = voteClaimSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "Vote site ID required", code: "invalid_request" }, { status: 400 });
    }
    const { voteSiteId } = parsed.data;

    const site = await prisma.voteSite.findUnique({ where: { id: voteSiteId } });
    if (!site) return NextResponse.json({ error: "Vote site not found", code: "not_found" }, { status: 404 });

    // A transaction on its own does not prevent a double record: under read
    // committed, two submitted together both read no recent vote log and both
    // go on to write one. The invariant here is "no row newer than the
    // cutoff", which no conditional write can express, so the isolation level
    // has to carry it. Postgres aborts one of two serializable transactions
    // whose reads and writes conflict this way; that abort is answered below
    // as a retry, not a 500.
    try {
        await prisma.$transaction(async (tx) => {
            const lastVote = await tx.voteLog.findFirst({
                where: { userId: session.user.id, voteSiteId },
                orderBy: { createdAt: "desc" },
            });

            if (lastVote) {
                const hoursSince = (Date.now() - lastVote.createdAt.getTime()) / (1000 * 60 * 60);
                if (hoursSince < 24) {
                    const hoursLeft = Math.ceil(24 - hoursSince);
                    throw new Error(`COOLDOWN:${hoursLeft}`);
                }
            }

            await tx.voteLog.create({
                data: { userId: session.user.id, voteSiteId },
            });
        }, { isolationLevel: "Serializable" });

        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("vote.vote.cast", {
            userId: session.user.id,
            voteSiteId,
            siteName: site.name,
        });
        await prisma.activityFeedItem.create({
            data: {
                type: "vote.vote.cast",
                actorId: session.user.id,
                title: `Voted on ${site.name}`,
                icon: "ThumbsUp",
                isPublic: true,
            },
        }).catch(() => {});

        return NextResponse.json({ message: `Vote recorded for ${site.name}.` });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        // The cooldown carries the hours left rather than a finished sentence:
        // the page reads two locales and the number belongs inside whichever
        // one the reader is on, not inside an English string built here.
        if (message.startsWith("COOLDOWN:")) {
            return NextResponse.json(
                {
                    error: `You can vote again in ${message.slice(9)} hours`,
                    code: "vote_cooldown",
                    hours: Number(message.slice(9)),
                },
                { status: 429 },
            );
        }
        // P2034: the transaction was aborted for conflicting with another one.
        // Two records arrived together and Postgres kept exactly one, which is
        // the point. The caller is told to try again rather than shown a 500.
        const code = (err as { code?: string }).code;
        if (code === "P2034") {
            return NextResponse.json(
                { error: "Another vote is in flight. Try again in a moment.", code: "vote_in_flight" },
                { status: 409 },
            );
        }
        throw err;
    }
}
