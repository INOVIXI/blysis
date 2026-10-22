import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { prisma } from "@/core/lib/db";
import { log } from "@/core/lib/logger";
import {
    blockedBy,
    coreReleasesUrl,
    isNewerVersion,
    nextInstallable,
    onChannel,
    parseReleases,
    stageOf,
    type CoreRelease,
} from "@/core/lib/core-releases";
import { UPDATE_CHANNELS, getUpdateChannel, setUpdateChannel } from "@/core/lib/update-channel";
import { canStart, readIntent, writeIntent } from "@/core/lib/core-update";
import { createBackup } from "@/core/lib/backup";
import { getMaintenanceConfig, setMaintenanceConfig } from "@/core/lib/maintenance";
import pkg from "../../../../../../package.json";

/**
 * What version this install runs, what it could run, and the button that gets
 * it there.
 *
 * The update itself is not done here and cannot be: this container has no
 * Docker socket, deliberately. `POST` records an intent on a shared volume and
 * the `updater` service does the work. See `src/core/lib/core-update.ts`.
 *
 * The request names a version. The tag handed on is the feed's tag for that
 * version, never anything the request carried, because that tag ends up naming
 * an image somebody pulls.
 */

const requestSchema = z.object({
    version: z.string().min(1).max(64),
    /**
     * Go ahead without a database dump. The backup is taken by default and a
     * failure stops the update; an install with no `pg_dump` - or one that
     * backs up from outside - says so explicitly rather than silently.
     */
    skipBackup: z.boolean().default(false),
});

const channelSchema = z.object({ channel: z.enum(UPDATE_CHANNELS) });

/** A release as the screen draws it: with whether it is a beta or a candidate. */
function withStage(release: CoreRelease | null) {
    return release ? { ...release, stage: stageOf(release.version) } : null;
}

function currentVersion(): string {
    return (pkg as { version: string }).version;
}

async function fetchReleases(): Promise<CoreRelease[] | null> {
    try {
        const res = await fetch(coreReleasesUrl(), { next: { revalidate: 300 } });
        if (!res.ok) return null;
        return parseReleases(await res.json());
    } catch {
        return null;
    }
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const current = currentVersion();
    const { channel, pinned } = await getUpdateChannel();
    const releases = await fetchReleases();
    const step = releases ? nextInstallable(releases, current, channel) : { target: null, newest: null };
    const intent = await readIntent();

    const history = await prisma.coreUpdate.findMany({
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
            id: true,
            fromVersion: true,
            toVersion: true,
            status: true,
            error: true,
            startedAt: true,
            finishedAt: true,
        },
    });

    return NextResponse.json({
        current,
        currentStage: stageOf(current),
        channel,
        channelPinned: pinned,
        // Distinguishable from "you are up to date": an install that cannot
        // reach the feed must not be told it is current.
        feedReadable: releases !== null,
        // The version this install may move to now, which is the step when the
        // newest one asks for one.
        latest: withStage(step.target),
        newest: withStage(step.newest),
        blockedBy: step.newest ? blockedBy(step.newest, current)?.version ?? null : null,
        intent,
        canStart: canStart(intent),
        history,
    }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Name the version to install." }, { status: 400 });
    }

    const releases = await fetchReleases();
    if (!releases) {
        return NextResponse.json(
            { error: "The release list could not be read, so there is nothing to install.", code: "feed_unreadable" },
            { status: 503 },
        );
    }

    const current = currentVersion();
    const wanted = parsed.data.version.replace(/^v/, "");
    const release = releases.find((r) => r.version.replace(/^v/, "") === wanted);
    if (!release || !isNewerVersion(current, release.version)) {
        return NextResponse.json(
            { error: "That version is not one this install can move to.", code: "unknown_version" },
            { status: 400 },
        );
    }

    // The screen offers only what the channel allows, and the request is held
    // to the same: a stable site is not moved to a beta by naming one.
    if (!onChannel(release.version, (await getUpdateChannel()).channel)) {
        return NextResponse.json(
            { error: "That version is a pre-release, and this site follows stable releases.", code: "not_on_channel" },
            { status: 400 },
        );
    }

    const step = blockedBy(release, current);
    if (step) {
        return NextResponse.json(
            {
                error: `Install ${step.version} first: this release needs it.`,
                code: "update_blocked",
                blockedBy: step.version,
            },
            { status: 409 },
        );
    }

    if (!canStart(await readIntent())) {
        return NextResponse.json(
            { error: "An update is already running.", code: "update_in_progress" },
            { status: 409 },
        );
    }

    // A dump first. The update itself can be rolled back by pinning the old
    // tag; the database cannot, so this is the only part of the sequence that
    // cannot be reconstructed afterwards.
    if (!parsed.data.skipBackup) {
        try {
            const meta = await createBackup("scheduled", `Before updating to ${release.version}`);
            log.info("[update] backup taken", { file: meta.filename, sizeBytes: meta.sizeBytes });
        } catch (err) {
            // The reason stays in the log. A backup failure names a path or a
            // connection string often enough that it is not something to hand
            // back over HTTP, and the admin has the backup screen for detail.
            log.error("[update] the backup before an update failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            return NextResponse.json(
                { error: "The backup before the update failed, so the update was not started.", code: "backup_failed" },
                { status: 409 },
            );
        }
    }

    // Maintenance mode for the swap, and only ours to undo: an operator who
    // was already in maintenance stays there when this is over.
    const maintenance = await getMaintenanceConfig();
    const maintenanceRestore = !maintenance.enabled;
    if (maintenanceRestore) {
        await setMaintenanceConfig({
            ...maintenance,
            enabled: true,
            message: maintenance.message?.trim() ? maintenance.message : "",
        });
    }

    const intent = await writeIntent({
        release,
        fromVersion: current,
        requestedBy: session.user.id,
        maintenanceRestore,
    });

    await prisma.coreUpdate.create({
        data: {
            fromVersion: current,
            toVersion: release.version,
            tag: release.tag,
            requestedBy: session.user.id,
            status: "requested",
        },
    });

    logActivity({
        userId: session.user.id,
        action: "core.update.request",
        entity: "core",
        entityId: release.version,
    });
    log.info("[update] requested", { from: current, to: release.version, tag: release.tag });

    return NextResponse.json({ intent }, { status: 202 });
}

/**
 * Choosing which releases the site is offered. Moving from beta back to
 * stable never steps the site down: updates only add to the database, so a
 * site on a pre-release stays on it until the release it previews ships.
 */
export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = channelSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Name a channel: stable or beta.", code: "invalid_input" }, { status: 400 });
    }

    if ((await getUpdateChannel()).pinned) {
        return NextResponse.json(
            { error: "BLYSIS_UPDATE_CHANNEL in .env decides the channel on this server.", code: "channel_pinned" },
            { status: 409 },
        );
    }

    await setUpdateChannel(parsed.data.channel);
    logActivity({
        userId: session.user.id,
        action: "core.update.channel",
        entity: "core",
        entityId: parsed.data.channel,
    }).catch(() => {});

    return NextResponse.json({ channel: parsed.data.channel });
}
