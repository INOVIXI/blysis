/**
 * The channel between the panel and the thing that can actually update.
 *
 * The app container does not hold the Docker socket, and should not: the
 * socket is root on the host, and this container runs module code that
 * arrives in a ZIP from outside. So updating is somebody else's job. The panel
 * writes an intent into a directory shared with the `updater` service, the
 * updater does the work the `blysis update` command does, and writes its
 * progress back into the same file for the screen to show.
 *
 * That makes this file a boundary in both directions. What goes out must be
 * safe to hand to a process that pulls an image by name, so the tag written
 * here is the one the release feed gave, never one a request carried. What
 * comes back was written by another process and is rendered on an admin
 * screen, so it is parsed rather than trusted.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CoreRelease } from "./core-releases";

/**
 * Where the shared volume is mounted. A default that exists in the image and
 * an override for a test or an unusual deployment.
 */
function stateDir(): string {
    return process.env.BLYSIS_UPDATE_DIR?.trim() || "/var/lib/blysis/update";
}

function intentPath(): string {
    return path.join(stateDir(), "intent.json");
}

/**
 * The updater is a shell script in a container with no JSON parser, so the
 * channel between the two sides is four small files rather than one document:
 *
 *   intent.json  what was asked for, written by the app, read by the panel
 *   request      one line, the tag, written last and deleted when picked up
 *   status       one word: running, done, failed
 *   progress.log the updater's own output, tailed onto the screen
 *   heartbeat    an ISO timestamp the updater rewrites as it works
 *
 * Splitting them means neither side has to parse the other's format, and the
 * one file the updater acts on carries exactly one value it already validates.
 */
const REQUEST_FILE = "request";
const STATUS_FILE = "status";
const PROGRESS_FILE = "progress.log";
const HEARTBEAT_FILE = "heartbeat";

function statePath(name: string): string {
    return path.join(/* turbopackIgnore: true */ stateDir(), name);
}

async function readSmall(name: string, max = 64 * 1024): Promise<string | null> {
    try {
        const raw = await fs.readFile(/* turbopackIgnore: true */ statePath(name), "utf8");
        return raw.slice(0, max).trim();
    } catch {
        return null;
    }
}

/** How long a run may go without a heartbeat before it is treated as gone. */
const UPDATE_HEARTBEAT_TIMEOUT_MS = 15 * 60_000;

const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const VERSION = /^v?\d+(\.\d+)*$/;

const intentSchema = z.object({
    tag: z.string().regex(TAG),
    toVersion: z.string().regex(VERSION),
    fromVersion: z.string().regex(VERSION),
    requestedBy: z.string().min(1),
    requestedAt: z.string().min(1),
    state: z.enum(["requested", "running", "done", "failed"]),
    /** What the updater is doing now, for the screen. */
    step: z.string().default(""),
    /** The tail of the updater's output, bounded so the file cannot grow. */
    log: z.array(z.string()).default([]),
    heartbeatAt: z.string().nullable().default(null),
    finishedAt: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
    /**
     * True when the update turned maintenance mode on and the boot after it
     * should turn it back off. An operator who was already in maintenance
     * stays there.
     */
    maintenanceRestore: z.boolean().default(false),
});

export type UpdateIntent = z.infer<typeof intentSchema>;

/**
 * The current intent as both sides know it: what the app asked for, with the
 * updater's own progress laid over the top.
 *
 * Null when there is nothing, or when what is there cannot be read - the file
 * is written by another process, so a half-written or edited one has to read
 * as absent rather than as a state the screen will render.
 */
export async function readIntent(): Promise<UpdateIntent | null> {
    let raw: string;
    try {
        raw = await fs.readFile(intentPath(), "utf8");
    } catch {
        return null;
    }
    let intent: UpdateIntent;
    try {
        const parsed = intentSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return null;
        intent = parsed.data;
    } catch {
        return null;
    }

    const status = await readSmall(STATUS_FILE, 32);
    if (status === "running" || status === "done" || status === "failed") {
        intent.state = status;
    }
    const heartbeat = await readSmall(HEARTBEAT_FILE, 64);
    if (heartbeat && !Number.isNaN(Date.parse(heartbeat))) intent.heartbeatAt = heartbeat;

    const progress = await readSmall(PROGRESS_FILE);
    if (progress) {
        // Bounded: this is rendered, and the updater appends for as long as it
        // runs. The end is the part that says what is happening now.
        const lines = progress.split("\n").filter(Boolean);
        intent.log = lines.slice(-40);
        intent.step = lines[lines.length - 1] ?? "";
    }
    return intent;
}

export interface WriteIntent {
    release: CoreRelease;
    fromVersion: string;
    requestedBy: string;
    state?: UpdateIntent["state"];
    heartbeatAt?: string;
    maintenanceRestore?: boolean;
}

/** Record that this version was asked for. The tag comes from the feed. */
export async function writeIntent(input: WriteIntent): Promise<UpdateIntent> {
    const intent: UpdateIntent = {
        tag: input.release.tag,
        toVersion: input.release.version,
        fromVersion: input.fromVersion,
        requestedBy: input.requestedBy,
        requestedAt: new Date().toISOString(),
        state: input.state ?? "requested",
        step: "",
        log: [],
        heartbeatAt: input.heartbeatAt ?? null,
        finishedAt: null,
        error: null,
        maintenanceRestore: input.maintenanceRestore ?? false,
    };
    await fs.mkdir(stateDir(), { recursive: true });
    // Written whole and moved into place: the updater polls this file, and a
    // half-written one would read as no intent at all.
    const tmp = `${intentPath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(intent, null, 2), "utf8");
    await fs.rename(tmp, intentPath());

    // The previous run's leavings go before the new request appears, or the
    // panel would show the last update's log against this one.
    for (const name of [STATUS_FILE, PROGRESS_FILE, HEARTBEAT_FILE]) {
        await fs.rm(statePath(name), { force: true });
    }

    // Last, and only for a request: the updater acts on this file's existence,
    // so it must not see one before the record beside it is complete.
    if (intent.state === "requested") {
        await fs.writeFile(statePath(REQUEST_FILE), `${intent.tag}\n`, "utf8");
    }
    return intent;
}

/**
 * May a new update start?
 *
 * Two pulls racing to recreate the same container is not a state worth
 * recovering from, so a run in flight refuses the next one. A run whose
 * heartbeat stopped is not in flight, whatever the file says: an updater that
 * was killed mid-pull would otherwise leave the button disabled until somebody
 * found the file on the volume.
 */
export function canStart(intent: UpdateIntent | null, now: number = Date.now()): boolean {
    if (!intent) return true;
    if (intent.state === "done" || intent.state === "failed") return true;
    if (!intent.heartbeatAt) {
        // Requested but never picked up: the updater may be a moment away, so
        // the request's own age is what decides.
        return now - Date.parse(intent.requestedAt) > UPDATE_HEARTBEAT_TIMEOUT_MS;
    }
    return now - Date.parse(intent.heartbeatAt) > UPDATE_HEARTBEAT_TIMEOUT_MS;
}

/** Mark the intent finished so the next boot does not act on it again. */
async function sealIntent(intent: UpdateIntent, state: UpdateIntent["state"]): Promise<void> {
    const sealed: UpdateIntent = { ...intent, state, finishedAt: new Date().toISOString() };
    const tmp = `${intentPath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(sealed, null, 2), "utf8");
    await fs.rename(tmp, intentPath());
}

export interface ReconcileResult {
    /** What this boot concluded, or null when there was nothing to conclude. */
    outcome: "done" | "failed" | null;
    /** Whether this boot took the site back out of maintenance. */
    reopened: boolean;
}

/**
 * What a boot makes of an update that was in flight when the process before it
 * stopped.
 *
 * This is the half of the sequence the updater cannot do: it has no database
 * and no idea what the site's maintenance setting was before. The app knows
 * both, and the boot after the swap is the first moment anything can say the
 * update arrived - the process saying so *is* the new version.
 *
 * A failed update boots the old version again, and the updater has already
 * written that word, so the same pass closes it out.
 */
export async function reconcileUpdate(
    runningVersion: string,
    onFinish: (outcome: "done" | "failed", intent: UpdateIntent) => Promise<void>,
): Promise<ReconcileResult> {
    const intent = await readIntent();
    if (!intent || intent.finishedAt) return { outcome: null, reopened: false };

    let outcome: "done" | "failed" | null = null;
    if (intent.state === "failed") {
        outcome = "failed";
    } else if (runningVersion.replace(/^v/, "") === intent.toVersion.replace(/^v/, "")) {
        // Whatever the updater is still waiting for, this process is the
        // version that was asked for.
        outcome = "done";
    }
    if (!outcome) return { outcome: null, reopened: false };

    await onFinish(outcome, intent);
    await sealIntent(intent, outcome);
    return { outcome, reopened: intent.maintenanceRestore };
}
