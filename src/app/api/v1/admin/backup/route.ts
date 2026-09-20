import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { createBackup, listBackups, formatBytes } from "@/core/lib/backup";
import {
    AUTOMATED_BACKUP_SCHEDULES,
    getAutomatedBackup,
    setAutomatedBackup,
} from "@/core/lib/backup-schedule";
import { canTakeABackup, resetBackupToolCheck } from "@/core/lib/backup-tools";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";

/** An optional note filed alongside a manual backup. */
const backupBodySchema = z.object({ notes: z.string().max(500).optional() });

/**
 * What the screen may change about the automated backup.
 *
 * Every field is optional and at least one is required, so the switch, the
 * cadence and the retention are three controls rather than one form that has
 * to send all of them back. The cadence is an enum of the offered list: an
 * unknown name would be stored happily and then turn the job into one that
 * never runs, because the scheduler has no interval for it.
 */
const scheduleBodySchema = z
    .object({
        automated: z.boolean().optional(),
        schedule: z.enum(AUTOMATED_BACKUP_SCHEDULES).optional(),
        keep: z.number().int().min(1).max(365).optional(),
    })
    .refine(
        (body) => body.automated !== undefined || body.schedule !== undefined || body.keep !== undefined,
        { message: "Nothing to change" },
    );

/**
 * GET /api/v1/admin/backup
 * List all available backups. Admin only.
 *
 * Response shape includes both structured `BackupMeta` fields and the legacy
 * `size` / `sizeHuman` / `createdAt` (string) fields so the older admin/system
 * page keeps working unchanged.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const backups = await listBackups();
        const serialised = backups.map((b) => ({
            id: b.id,
            filename: b.filename,
            type: b.type,
            sizeBytes: b.sizeBytes,
            // Legacy fields for admin/system page compatibility
            size: b.sizeBytes,
            sizeHuman: formatBytes(b.sizeBytes),
            createdAt: b.createdAt.toISOString(),
            notes: b.notes ?? null,
        }));
        return NextResponse.json({
            backups: serialised,
            total: serialised.length,
            // The screen shows what the job is really set to, read from the
            // same place the job reads it rather than assumed.
            automated: await getAutomatedBackup(),
            // The cadences on offer travel with the answer, so the screen does
            // not keep a second copy of a list core owns.
            schedules: [...AUTOMATED_BACKUP_SCHEDULES],
            /*
             * Whether a backup can be taken here at all. Asked before one is
             * attempted, because the two ways `pg_dump` fails are both quiet
             * until somebody needs a backup - and finding out then is finding
             * out too late.
             */
            tools: await canTakeABackup(),
        });
    } catch {
        return NextResponse.json({ error: "Failed to list backups" }, { status: 500 });
    }
}

/**
 * POST /api/v1/admin/backup
 * Create a new manual backup. Body is optional: { notes?: string }.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let notes: string | undefined;
    try {
        const body = await readJsonBody(request, { fallback: null });
        if (body instanceof NextResponse) return body;
        const parsed = backupBodySchema.safeParse(body);
        if (parsed.success && parsed.data.notes) notes = parsed.data.notes;
    } catch {
        // empty body → just proceed
    }

    // Asked again, because pressing this is what an operator does straight
    // after installing the client tools the screen told them were missing.
    resetBackupToolCheck();

    try {
        const meta = await createBackup("manual", notes);

        logActivity({
            userId: session.user.id,
            action: "backup.create",
            entity: "backup",
            entityId: meta.id,
            metadata: { id: meta.id, filename: meta.filename, sizeBytes: meta.sizeBytes, notes: meta.notes ?? null },
        }).catch(() => {});

        return NextResponse.json(
            {
                message: "Backup created",
                backup: {
                    id: meta.id,
                    filename: meta.filename,
                    type: meta.type,
                    sizeBytes: meta.sizeBytes,
                    size: meta.sizeBytes,
                    sizeHuman: formatBytes(meta.sizeBytes),
                    createdAt: meta.createdAt.toISOString(),
                    notes: meta.notes ?? null,
                },
            },
            { status: 201 },
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : "Backup failed";
        // Scrub any accidental password leak defensively
        const safe = message.replace(/(password|PGPASSWORD)=[^\s]+/gi, "$1=***");
        return NextResponse.json({ error: `Backup failed: ${safe}` }, { status: 500 });
    }
}

/**
 * PATCH /api/v1/admin/backup
 * Change the automated backup. Body: { automated?, schedule?, keep? }.
 *
 * An operator who dumps the database from outside the application has no use
 * for this job, and before the switch existed the only state open to them was
 * one failed run a night. The cadence and how many to keep were written into
 * the source beside the job, which is not where either of them belongs.
 */
export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = scheduleBodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const { automated, schedule, keep } = parsed.data;
    const next = await setAutomatedBackup({
        ...(automated === undefined ? {} : { enabled: automated }),
        ...(schedule === undefined ? {} : { schedule }),
        ...(keep === undefined ? {} : { keep }),
    });

    logActivity({
        userId: session.user.id,
        // Switching it off is the change worth finding in the log later; the
        // other two are recorded as what they are.
        action: automated === false ? "backup.schedule.disable" : "backup.schedule.update",
        entity: "backup",
        metadata: { enabled: next.enabled, schedule: next.schedule, keep: next.keep },
    });

    return NextResponse.json({ automated: next });
}
