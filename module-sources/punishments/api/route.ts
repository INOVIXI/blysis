import { NextRequest, NextResponse } from "next/server";
import { pageParams, isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { parseDuration } from "../lib/duration";
import { punishmentCreateSchema } from "../lib/validations";
import { canonicalType } from "../lib/punishment-types";
import { readPunishments } from "../lib/read-punishments";

// GET - Public: list punishments
//
// The read and what a filter means live in lib/read-punishments.ts, because
// the page renders the record on the server now and a type filter has to mean
// the same thing on both.
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const { page, limit } = pageParams(params);
    const read = await readPunishments({
        type: params.get("type"),
        search: params.get("search"),
        status: params.get("status"),
        scope: params.get("scope"),
        page,
        perPage: limit,
    });
    return NextResponse.json({
        punishments: read.punishments,
        total: read.total,
        pages: read.pages,
        scopes: read.scopes,
    });
}

/**
 * An administrator issues a punishment on this site.
 *
 * This used to accept an API key as well, so a game server's plugin could
 * post its bans here. That made a module about a member's record the owner of
 * one plugin's payload shape, its spelling of a ban and its idea of who a
 * player is. A module that watches such a server asks `punishment.record`
 * now, and `hooks/record.ts` writes the row; what arrives here is a person
 * with an admin session, and it is filed under the source `site`.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const issuerUserId: string = session.user.id;

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = punishmentCreateSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "playerName and type required" }, { status: 400 });
    }
    const { playerName, playerUuid, type, reason, duration, punishedBy, expiresAt, scopeId } = parsed.data;

    /*
     * When it ends, from the length that was asked for.
     *
     * `duration` was stored verbatim and read by nothing: the status is
     * decided from `expiresAt`, which only ever came from a second box below
     * the duration field. So `7d` with that box left alone was a permanent
     * ban that showed as Active for ever. The shorthand decides now, and an
     * explicit end date still wins where one is given - a game server
     * reporting in sends the date it worked out itself.
     */
    const ends = parseDuration(duration, new Date());
    if (ends === undefined) {
        return NextResponse.json({ error: "duration is not a length", code: "bad_duration" }, { status: 400 });
    }
    const endsAt = expiresAt ? new Date(expiresAt) : ends;
    // Stored in this module's own words when it recognises them, so the
    // filters and the labels have one thing to match.
    const storedType = canonicalType(type) ?? type;

    // The member this is against, when the name is one. A punishment issued
    // here is about somebody with an account; one that arrives from a game
    // server may not be, which is why the column is nullable.
    const member = await prisma.user.findFirst({
        where: { username: { equals: playerName, mode: "insensitive" } },
        select: { id: true },
    });

    const punishment = await prisma.punishment.create({
        data: {
            userId: member?.id ?? null,
            source: "site",
            playerName,
            playerUuid: playerUuid || null,
            type: storedType,
            reason: reason || null,
            duration: duration || null,
            punishedBy: punishedBy || null,
            scopeId: scopeId || null,
            expiresAt: endsAt,
        },
    });

    const targetUser = member;

    // For warning-type punishments, also record a UserWarning row
    if (storedType === "warning") {
        if (targetUser) {
            await prisma.userWarning.create({
                data: {
                    userId: targetUser.id,
                    issuedById: issuerUserId,
                    reason: reason || "No reason provided",
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                },
            }).catch(() => {});
        }
    }

    // Fire hook + activity feed entry (private)
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("punishments.punishment.issued", {
        punishmentId: punishment.id,
        playerName,
        type: storedType,
        reason,
        issuerUserId,
        targetUserId: targetUser?.id ?? null,
    });
    if (targetUser) {
        await prisma.activityFeedItem.create({
            data: {
                type: "punishments.punishment.issued",
                actorId: issuerUserId,
                title: `${storedType} issued to ${playerName}${reason ? `: ${reason}` : ""}`,
                icon: "AlertTriangle",
                isPublic: false,
            },
        }).catch(() => {});
    }

    return NextResponse.json({ punishment }, { status: 201 });
}
